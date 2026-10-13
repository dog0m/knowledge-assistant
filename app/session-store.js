// app/session-store.js
//
// 会话存储抽象层。
// 为什么需要它：原来登录会话虽然写进 PostgreSQL，但登录失败计数只存在单个进程的内存里。
// 一旦用 `docker compose up --scale app=3` 起多个副本，就会出现
// "A 副本记录了失败次数，B 副本却看不到" 的问题，导致限流形同虚设。
// 这里把"会话"和"登录失败计数"统一收敛到一个可替换的存储接口：
//   - postgres（默认）：多副本共享，适合生产
//   - memory          ：单进程内存，适合本地快速开发或单副本场景
// 选择方式：环境变量 SESSION_STORE=postgres|memory
//
// 说明：本模块只负责"存什么"，不负责"怎么鉴权"。鉴权逻辑仍留在 server.js，
// 这样安全相关代码只有一处，便于审计。

const crypto = require("crypto");

// 令牌只把哈希写库，明文令牌仅存在于浏览器 Cookie / Authorization 头。
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// 会话默认有效期 12 小时，可用 SESSION_TTL_HOURS 覆盖。
const DEFAULT_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
// 登录失败窗口和上限：10 分钟内失败 10 次即锁定。
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 10 * 60 * 1000);
const LOGIN_MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES || 10);

// ---------------------------------------------------------------------------
// 内存实现：单进程使用。用 Map 保存，读写前顺手清理过期项，避免长期运行内存膨胀。
// ---------------------------------------------------------------------------
function createMemorySessionStore() {
  const sessions = new Map(); // token_hash -> { user_id, expires_at }
  const failures = new Map(); // key -> { count, expires_at }

  function sweep() {
    const now = Date.now();
    for (const [key, item] of sessions) if (item.expires_at <= now) sessions.delete(key);
    for (const [key, item] of failures) if (item.expires_at <= now) failures.delete(key);
  }

  return {
    kind: "memory",
    async init() {},
    async createSession(userId) {
      sweep();
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(hashToken(token), { user_id: userId, expires_at: Date.now() + DEFAULT_TTL_HOURS * 3600 * 1000 });
      return token;
    },
    async resolveSession(token) {
      const item = sessions.get(hashToken(token));
      if (!item || item.expires_at <= Date.now()) return null;
      return { user_id: item.user_id };
    },
    async deleteSession(token) {
      sessions.delete(hashToken(token));
    },
    async deleteSessionsForUser(userId) {
      for (const [key, item] of sessions) if (item.user_id === userId) sessions.delete(key);
    },
    async isLoginBlocked(key) {
      sweep();
      const item = failures.get(key);
      return Boolean(item && item.count >= LOGIN_MAX_FAILURES);
    },
    async recordLoginFailure(key) {
      const item = failures.get(key) || { count: 0, expires_at: Date.now() + LOGIN_WINDOW_MS };
      item.count += 1;
      failures.set(key, item);
      return item.count;
    },
    async clearLoginFailures(key) {
      failures.delete(key);
    }
  };
}

// ---------------------------------------------------------------------------
// PostgreSQL 实现：多副本共享。
// 复用已有的 sessions 表，并新增 login_failures 表用于跨副本限流。
// ---------------------------------------------------------------------------
function createPostgresSessionStore(pool) {
  return {
    kind: "postgres",
    async init() {
      // login_failures 用主键 upsert，避免并发写入产生重复行。
      await pool.query(`
        CREATE TABLE IF NOT EXISTS login_failures (
          failure_key TEXT PRIMARY KEY,
          count INTEGER NOT NULL DEFAULT 0,
          expires_at TIMESTAMPTZ NOT NULL
        )
      `);
    },
    async createSession(userId) {
      const token = crypto.randomBytes(32).toString("hex");
      await pool.query(
        `INSERT INTO sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + ($3 || ' hours')::interval)`,
        [hashToken(token), userId, String(DEFAULT_TTL_HOURS)]
      );
      return token;
    },
    async resolveSession(token) {
      const result = await pool.query(
        "SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at > NOW()",
        [hashToken(token)]
      );
      return result.rows[0] || null;
    },
    async deleteSession(token) {
      await pool.query("DELETE FROM sessions WHERE token_hash=$1", [hashToken(token)]);
    },
    async deleteSessionsForUser(userId) {
      await pool.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
    },
    async isLoginBlocked(key) {
      const result = await pool.query(
        "SELECT count FROM login_failures WHERE failure_key=$1 AND expires_at > NOW()",
        [key]
      );
      return Boolean(result.rows[0] && result.rows[0].count >= LOGIN_MAX_FAILURES);
    },
    async recordLoginFailure(key) {
      // 窗口过期时用 1 重新计数，否则累加。
      const result = await pool.query(
        `INSERT INTO login_failures (failure_key, count, expires_at)
         VALUES ($1, 1, NOW() + ($2 || ' milliseconds')::interval)
         ON CONFLICT (failure_key) DO UPDATE SET
           count = CASE WHEN login_failures.expires_at <= NOW() THEN 1 ELSE login_failures.count + 1 END,
           expires_at = CASE WHEN login_failures.expires_at <= NOW()
                             THEN NOW() + ($2 || ' milliseconds')::interval
                             ELSE login_failures.expires_at END
         RETURNING count`,
        [key, String(LOGIN_WINDOW_MS)]
      );
      return result.rows[0].count;
    },
    async clearLoginFailures(key) {
      await pool.query("DELETE FROM login_failures WHERE failure_key=$1", [key]);
    }
  };
}

// 工厂函数：server.js 只依赖这里返回的接口，不关心底层是内存还是数据库。
function createSessionStore({ pool, kind = process.env.SESSION_STORE || "postgres" }) {
  if (String(kind).toLowerCase() === "memory") return createMemorySessionStore();
  return createPostgresSessionStore(pool);
}

module.exports = { createSessionStore, hashToken, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, DEFAULT_TTL_HOURS };
