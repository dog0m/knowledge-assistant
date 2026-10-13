const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const cookieParser = require("cookie-parser");
// 会话存储：默认走 PostgreSQL 多副本共享，可用 SESSION_STORE=memory 切回单进程内存。
const { createSessionStore } = require("./session-store");

// Express API 负责基础健康检查和统一的模型调用入口。
const app = express();
const port = process.env.PORT || 3000;
// 限制 JSON 请求体大小，避免误上传过大的请求。
app.use(express.json({ limit: "1mb" }));
// 解析会话 Cookie，支持浏览器直接登录而不只是 Bearer Token。
app.use(cookieParser());

// 阶段 5 基础安全响应头：不引入额外依赖，先降低浏览器侧常见攻击面。
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");
  next();
});

// 登录失败计数与会话统一交给会话存储：默认 PostgreSQL，多副本共享；SESSION_STORE=memory 时退回单进程内存。

// PostgreSQL 连接池；连接信息全部通过环境变量注入。
const pool = new Pool({
  host: process.env.DB_HOST || "db",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// 连接池建好后再实例化 store；store 内部只依赖 pool.query，便于替换与测试。
const sessionStore = createSessionStore({ pool });

const RAG_BASE_URL = (process.env.RAG_BASE_URL || "http://rag:8090").replace(/\/$/, "");
const uploadDirectory = path.join(require("os").tmpdir(), "my-agent-uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({
  // 临时文件写磁盘，避免多文件上传时把整个批次保存在 Node.js 内存。
  storage: multer.diskStorage({ destination: uploadDirectory }),
  limits: { files: 50, fileSize: 50 * 1024 * 1024 }
});

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

async function initStage4Database() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
      department TEXT NOT NULL DEFAULT 'platform', active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS departments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT UNIQUE NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, description TEXT DEFAULT '',
      department TEXT NOT NULL DEFAULT 'platform', owner_id UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS kb_members (
      knowledge_base_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (knowledge_base_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS kb_documents (
      knowledge_base_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      document_id UUID NOT NULL,
      PRIMARY KEY (knowledge_base_id, document_id)
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '新会话', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY, session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL,
      trace_id UUID, sources JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id BIGSERIAL PRIMARY KEY, user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL, trace_id UUID,
      rating INTEGER CHECK (rating BETWEEN 1 AND 5), comment TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // 会话存储可能需要在数据库里补建 login_failures 表（多副本限流用）。
  await sessionStore.init();
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || "change-me-now";
  await pool.query(
    `INSERT INTO users (username, password_hash, display_name, role, department)
     VALUES ($1, $2, '系统管理员', 'admin', 'platform') ON CONFLICT (username) DO NOTHING`,
    [process.env.ADMIN_INITIAL_USERNAME || "admin", hashPassword(adminPassword)]
  );
  await pool.query("INSERT INTO departments (name) VALUES ('platform') ON CONFLICT (name) DO NOTHING");
  await pool.query(
    `INSERT INTO knowledge_bases (name, description, department, owner_id)
     SELECT '平台技术支持', '阶段 0/2 的技术支持试点知识库', 'platform', id FROM users WHERE username=$1
     AND NOT EXISTS (SELECT 1 FROM knowledge_bases WHERE name='平台技术支持')`,
    [process.env.ADMIN_INITIAL_USERNAME || "admin"]
  );
  await pool.query(
    `INSERT INTO kb_members (knowledge_base_id,user_id)
     SELECT kb.id,u.id FROM knowledge_bases kb CROSS JOIN users u
     WHERE kb.name='平台技术支持' AND u.username=$1 ON CONFLICT DO NOTHING`,
    [process.env.ADMIN_INITIAL_USERNAME || "admin"]
  );
}

async function currentUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.headers.cookie?.match(/kb_session=([^;]+)/)?.[1];
  if (!token) return null;
  // 会话解析交给存储层（可能是数据库，也可能是内存）；拿到 user_id 后再补查用户信息。
  const session = await sessionStore.resolveSession(token);
  if (!session) return null;
  const result = await pool.query(
    "SELECT id, username, display_name, role, department FROM users WHERE id=$1 AND active=TRUE",
    [session.user_id]
  );
  return result.rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    req.user = await currentUser(req);
    if (!req.user) return res.status(401).json({ error: "登录已过期或未登录" });
    next();
  } catch (error) { next(error); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "没有执行该操作的权限" });
    next();
  };
}

async function syncKnowledgeBaseDocumentAccess(knowledgeBaseId) {
  const [members, documents] = await Promise.all([
    pool.query("SELECT user_id FROM kb_members WHERE knowledge_base_id=$1", [knowledgeBaseId]),
    pool.query("SELECT document_id FROM kb_documents WHERE knowledge_base_id=$1", [knowledgeBaseId])
  ]);
  const allowedUsers = members.rows.map(row => row.user_id);
  for (const document of documents.rows) {
    await ragRequest(`/documents/${document.document_id}/kb-access`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_users: allowedUsers })
    });
  }
  return allowedUsers;
}

async function ragRequest(url, options = {}) {
  // app 与 RAG 之间使用共享密钥；请求体中的身份字段只在内部鉴权通过后处理。
  const headers = new Headers(options.headers || {});
  headers.set("X-Internal-Token", process.env.INTERNAL_API_KEY || "");
  const response = await fetch(`${RAG_BASE_URL}${url}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.detail || payload.error || `RAG request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function stage4ErrorHandler(error, req, res, next) {
  console.error(error);
  const status = error.status || 500;
  // 生产响应只返回 trace_id，内部错误细节写入日志，避免泄露数据库和上游密钥信息。
  const traceId = crypto.randomUUID();
  console.error(JSON.stringify({ trace_id: traceId, path: req.path, status, error: error.message }));
  res.status(status).json({ error: "服务处理失败", trace_id: traceId });
}

app.get("/", async (req, res) => {
  // 浏览器访问根路径时显示阶段 4 管理界面；服务状态请使用 /health。
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "database unavailable" });
  }
});

function modelConfig() {
  // 两种模型后端统一为同一份配置，业务接口不绑定具体供应商。
  const provider = (process.env.MODEL_PROVIDER || "ollama").toLowerCase();
  return {
    provider,
    model: provider === "openai"
      ? process.env.OPENAI_MODEL || "gpt-4o-mini"
      : process.env.OLLAMA_MODEL || "llama3.2:3b",
    baseUrl: provider === "openai"
      ? (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")
      : (process.env.OLLAMA_BASE_URL || "http://ollama:11434").replace(/\/$/, "")
  };
}

app.get("/api/model/config", (req, res) => {
  const config = modelConfig();
  res.json({ provider: config.provider, model: config.model, baseUrl: config.baseUrl });
});

app.get("/api/model/health", async (req, res) => {
  const config = modelConfig();
  try {
    // Ollama 使用 /api/tags，OpenAI 及兼容服务使用标准 /models。
    const healthPath = config.provider === "ollama" ? "/api/tags" : "/models";
    const response = await fetch(`${config.baseUrl}${healthPath}`, {
      headers: process.env.OPENAI_API_KEY ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {}
    });
    res.status(response.ok ? 200 : 503).json({
      status: response.ok ? "ok" : "unavailable",
      provider: config.provider,
      model: config.model,
      upstreamStatus: response.status
    });
  } catch (error) {
    res.status(503).json({ status: "unavailable", provider: config.provider, model: config.model, error: error.message });
  }
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  const config = modelConfig();
  // 过滤历史消息，并加入统一的系统提示词。
  const messages = [
    { role: "system", content: "You are an enterprise knowledge assistant. Answer using only provided context when context is supplied, and state uncertainty clearly." },
    ...history.filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string"),
    { role: "user", content: message }
  ];

  try {
    let response;
    if (config.provider === "openai") {
      if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY is not configured" });
      // OpenAI 官方接口和 OpenAI-compatible 服务均使用 chat/completions 协议。
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: config.model, messages, temperature: 0.2 })
      });
    } else if (config.provider === "ollama") {
      // Ollama 的请求结构相近，但接口路径和返回字段不同。
      response = await fetch(`${config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.model, messages, stream: false })
      });
    } else {
      return res.status(400).json({ error: `Unsupported MODEL_PROVIDER: ${config.provider}` });
    }

    const payload = await response.json();
    if (!response.ok) return res.status(502).json({ error: "Model service request failed", details: payload });
    // 将两个供应商的响应统一为相同的 answer 字段。
    const answer = config.provider === "openai" ? payload.choices?.[0]?.message?.content : payload.message?.content;
    res.json({ provider: config.provider, model: config.model, answer: answer || "" });
  } catch (error) {
    res.status(502).json({ error: "Model service unavailable", details: error.message });
  }
});

// 登录后返回随机会话令牌；数据库只保存令牌哈希，避免明文令牌泄露。
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "username 和 password 必填" });
    // 限流 key 用 IP + 用户名；计数存在共享存储里，多副本下仍然生效。
    const key = `${req.ip}:${String(username).slice(0, 80)}`;
    if (await sessionStore.isLoginBlocked(key)) {
      return res.status(429).json({ error: "登录失败次数过多，请 10 分钟后重试" });
    }
    const result = await pool.query("SELECT * FROM users WHERE username=$1 AND active=TRUE", [username]);
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      await sessionStore.recordLoginFailure(key);
      return res.status(401).json({ error: "用户名或密码错误" });
    }
    await sessionStore.clearLoginFailures(key);
    // 会话由存储层生成并持久化，返回的明文令牌只出现在这一次响应里。
    const token = await sessionStore.createSession(user.id);
    res.cookie?.("kb_session", token, { httpOnly: true, sameSite: "lax", maxAge: 12 * 60 * 60 * 1000 });
    res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, department: user.department } });
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", requireAuth, async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.headers.cookie?.match(/kb_session=([^;]+)/)?.[1];
    if (token) await sessionStore.deleteSession(token);
    res.clearCookie?.("kb_session");
    res.json({ status: "ok" });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.post("/api/auth/change-password", requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (typeof new_password !== "string" || new_password.length < 10) return res.status(400).json({ error: "新密码至少 10 位" });
    const row = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
    if (!row.rowCount || !verifyPassword(current_password || "", row.rows[0].password_hash)) return res.status(401).json({ error: "当前密码错误" });
    await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hashPassword(new_password), req.user.id]);
    // 改密后让所有旧会话立即失效（跨副本同样生效）。
    await sessionStore.deleteSessionsForUser(req.user.id);
    res.json({ status: "ok" });
  } catch (error) { next(error); }
});

// 部门是集中维护的选项；普通用户可以读取，只有管理员可以新增。
app.get("/api/departments", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id,name,active,created_at FROM departments WHERE active=TRUE ORDER BY name");
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.post("/api/admin/departments", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!/^\S{2,80}$/.test(name)) return res.status(400).json({ error: "部门名称为 2-80 个字符，不能包含空格" });
    const result = await pool.query("INSERT INTO departments (name) VALUES ($1) RETURNING id,name,active,created_at", [name]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

// 知识库接口：普通用户只能看到自己所在部门或明确加入的知识库。
app.get("/api/knowledge-bases", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT kb.*, EXISTS (SELECT 1 FROM kb_members m WHERE m.knowledge_base_id=kb.id AND m.user_id=$1) AS is_member,
       (SELECT COUNT(*)::int FROM kb_members m WHERE m.knowledge_base_id=kb.id) AS member_count
       FROM knowledge_bases kb WHERE $2 IN ('admin','auditor') OR kb.department=$3 OR EXISTS
       (SELECT 1 FROM kb_members m WHERE m.knowledge_base_id=kb.id AND m.user_id=$1) ORDER BY kb.created_at DESC`,
      [req.user.id, req.user.role, req.user.department]
    );
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.get("/api/admin/users", requireAuth, requireRole("admin", "maintainer"), async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id, username, display_name, role, department, active, created_at FROM users WHERE $1='admin' OR department=$2 ORDER BY created_at DESC", [req.user.role, req.user.department]);
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.post("/api/admin/users", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const { username, password, display_name, role = "user", department = "platform" } = req.body || {};
    const departmentExists = await pool.query("SELECT 1 FROM departments WHERE name=$1 AND active=TRUE", [department]);
    if (!departmentExists.rowCount || !/^[A-Za-z0-9_.-]{3,64}$/.test(username || "") || typeof password !== "string" || password.length < 10 || !display_name || !["user", "maintainer", "auditor"].includes(role)) {
      return res.status(400).json({ error: "请填写有效用户名、至少 10 位密码、显示名称和有效角色" });
    }
    const result = await pool.query(
      "INSERT INTO users (username,password_hash,display_name,role,department) VALUES ($1,$2,$3,$4,$5) RETURNING id,username,display_name,role,department,active,created_at",
      [username, hashPassword(password), display_name, role, department]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.put("/api/knowledge-bases/:id/members", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const memberIds = [...new Set((req.body?.user_ids || []).filter(id => typeof id === "string"))];
    if (memberIds.length > 500) return res.status(400).json({ error: "知识库成员最多 500 人" });
    if (memberIds.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return res.status(400).json({ error: "成员列表包含无效用户 ID" });
    const kb = await pool.query("SELECT id,department FROM knowledge_bases WHERE id=$1", [req.params.id]);
    if (!kb.rowCount) return res.status(404).json({ error: "知识库不存在" });
    if (req.user.role !== "admin") return res.status(403).json({ error: "只有管理员可以管理知识库成员" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM kb_members WHERE knowledge_base_id=$1", [req.params.id]);
      if (memberIds.length) await client.query("INSERT INTO kb_members (knowledge_base_id,user_id) SELECT $1,id FROM users WHERE id=ANY($2::uuid[]) AND active=TRUE ON CONFLICT DO NOTHING", [req.params.id, memberIds]);
      await client.query("COMMIT");
      // 同步已入库文档的 ACL，让新成员能检索，移除成员后也会立即失去访问权。
      const allowedUsers = await syncKnowledgeBaseDocumentAccess(req.params.id);
      res.json({ knowledge_base_id: req.params.id, member_count: allowedUsers.length });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  } catch (error) { next(error); }
});

// 管理员可以使用用户名或 UUID 添加成员。用户名重复时必须传 UUID，避免误授权。
app.post("/api/knowledge-bases/:id/members/add", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const identifier = String(req.body?.username || req.body?.user_id || "").trim();
    if (!identifier) return res.status(400).json({ error: "请提供用户名或用户 UUID" });
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
    const users = await pool.query(isUuid ? "SELECT id,username,display_name FROM users WHERE id=$1 AND active=TRUE" : "SELECT id,username,display_name FROM users WHERE username=$1 AND active=TRUE", [identifier]);
    if (!users.rowCount) return res.status(404).json({ error: "用户不存在或已停用" });
    if (!isUuid) {
      const sameName = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE username=$1 AND active=TRUE", [identifier]);
      if (sameName.rows[0].count > 1) return res.status(409).json({ error: "用户名不唯一，请改用用户 UUID" });
    }
    const kb = await pool.query("SELECT id FROM knowledge_bases WHERE id=$1", [req.params.id]);
    if (!kb.rowCount) return res.status(404).json({ error: "知识库不存在" });
    await pool.query("INSERT INTO kb_members (knowledge_base_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [req.params.id, users.rows[0].id]);
    await syncKnowledgeBaseDocumentAccess(req.params.id);
    res.json({ added: users.rows[0] });
  } catch (error) { next(error); }
});

app.delete("/api/knowledge-bases/:id/members/:userId", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const kb = await pool.query("SELECT id FROM knowledge_bases WHERE id=$1", [req.params.id]);
    if (!kb.rowCount) return res.status(404).json({ error: "知识库不存在" });
    await pool.query("DELETE FROM kb_members WHERE knowledge_base_id=$1 AND user_id=$2", [req.params.id, req.params.userId]);
    await syncKnowledgeBaseDocumentAccess(req.params.id);
    res.json({ removed: true, knowledge_base_id: req.params.id, user_id: req.params.userId });
  } catch (error) { next(error); }
});

app.post("/api/knowledge-bases", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const { name, description = "", department = req.user.department } = req.body || {};
    if (!name || typeof name !== "string" || name.length > 120) return res.status(400).json({ error: "知识库名称必填且不能超过 120 个字符" });
    const departmentExists = await pool.query("SELECT 1 FROM departments WHERE name=$1 AND active=TRUE", [department]);
    if (!departmentExists.rowCount) return res.status(400).json({ error: "请选择有效部门" });
    const result = await pool.query("INSERT INTO knowledge_bases (name, description, department, owner_id) VALUES ($1,$2,$3,$4) RETURNING *", [name, description, department, req.user.id]);
    await pool.query("INSERT INTO kb_members (knowledge_base_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [result.rows[0].id, req.user.id]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

// 文档列表和状态从 RAG 服务读取，管理 API 统一代入当前用户的部门和角色。
app.get("/api/documents", requireAuth, async (req, res, next) => {
  try {
    const query = new URLSearchParams({ user_id: req.user.id, department: req.user.department, role: req.user.role });
    res.json({ items: await ragRequest(`/documents?${query}`) });
  } catch (error) { next(error); }
});

app.get("/api/documents/export", requireAuth, requireRole("admin", "maintainer", "auditor"), async (req, res, next) => {
  try {
    const query = new URLSearchParams({ user_id: req.user.id, department: req.user.department, role: req.user.role });
    const docs = await ragRequest(`/documents?${query}`);
    const columns = ["id", "filename", "status", "department", "sensitivity", "version", "chunk_count", "retry_count", "error_message", "created_at", "updated_at"];
    const cell = value => {
      const text = String(value ?? "");
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = [columns.join(","), ...docs.map(doc => columns.map(key => cell(doc[key])).join(","))].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=documents.csv");
    res.send(`\uFEFF${csv}`);
  } catch (error) { next(error); }
});

function limitUploadRequest(req, res, next) {
  // multipart 有固定报文开销，预先限制请求体避免在 Multer 落盘前占满临时目录。
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > 105 * 1024 * 1024) return res.status(413).json({ error: "单批上传总量不能超过 100 MB" });
  next();
}

app.post("/api/documents/batch", requireAuth, requireRole("admin", "maintainer"), limitUploadRequest, upload.array("files", 50), async (req, res, next) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: "至少上传一个文件" });
    const totalBytes = req.files.reduce((total, file) => total + file.size, 0);
    if (totalBytes > 100 * 1024 * 1024) return res.status(413).json({ error: "单批上传总量不能超过 100 MB" });
    let documentDepartment = req.body.department || req.user.department;
    let allowedUsers = (req.body.allowed_users || "").split(",").map(id => id.trim()).filter(Boolean);
    let kbAllowedUsers = [];
    if (req.body.knowledge_base_id) {
      const kb = await pool.query("SELECT department FROM knowledge_bases WHERE id=$1", [req.body.knowledge_base_id]);
      if (!kb.rowCount) return res.status(404).json({ error: "知识库不存在" });
      if (req.user.role !== "admin" && kb.rows[0].department !== req.user.department) return res.status(403).json({ error: "不能向其他部门的知识库导入文档" });
      const members = await pool.query("SELECT user_id FROM kb_members WHERE knowledge_base_id=$1", [req.body.knowledge_base_id]);
      documentDepartment = `kb_${req.body.knowledge_base_id}`;
      kbAllowedUsers = [...new Set([...members.rows.map(row => row.user_id), req.user.id])];
    }
    const results = [];
    for (const file of req.files) {
      try {
        const form = new FormData();
        const content = await fs.promises.readFile(file.path);
        form.append("file", new Blob([content], { type: file.mimetype }), file.originalname);
        form.append("department", documentDepartment);
        form.append("sensitivity", req.body.sensitivity || "L1");
        form.append("allowed_users", allowedUsers.join(","));
        form.append("kb_allowed_users", kbAllowedUsers.join(","));
        if (req.body.knowledge_base_id) form.append("knowledge_base_id", req.body.knowledge_base_id);
        form.append("user_id", req.user.id);
        const document = await ragRequest("/documents", { method: "POST", body: form });
        results.push({ filename: file.originalname, document_id: document.id, status: document.status, chunk_count: document.chunk_count || 0 });
        if (req.body.knowledge_base_id) await pool.query("INSERT INTO kb_documents (knowledge_base_id,document_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [req.body.knowledge_base_id, document.id]);
      } catch (error) {
        results.push({ filename: file.originalname, status: "failed", error_message: error.message });
      }
    }
    const succeeded = results.filter(item => item.status === "queued").length;
    res.status(201).json({ total: results.length, succeeded, queued: succeeded, failed: results.length - succeeded, results });
  } catch (error) { next(error); }
  finally { for (const file of req.files || []) await fs.promises.unlink(file.path).catch(() => {}); }
});

// 文档 ACL 可视化编辑器数据源：一次返回"手工 ACL + 知识库 ACL + 候选用户"。
// 前端据此渲染勾选列表，避免让管理员手抄 UUID。
app.get("/api/documents/:id/access", requireAuth, requireRole("admin", "maintainer"), async (req, res, next) => {
  try {
    // 用 admin 角色读元数据，便于展示完整 ACL；越权写操作仍由下面的 PUT 单独校验。
    const document = await ragRequest(`/documents/${req.params.id}?user_id=${encodeURIComponent(req.user.id)}&department=${encodeURIComponent(req.user.department)}&role=admin`);
    const manual = document.manual_allowed_users || [];
    const kbDirect = document.kb_allowed_users || [];
    // 文档所属知识库的成员同样是有效授权来源，这里一并查出来做只读展示。
    const kbRows = await pool.query(
      "SELECT DISTINCT m.user_id FROM kb_documents d JOIN kb_members m ON m.knowledge_base_id=d.knowledge_base_id WHERE d.document_id=$1",
      [req.params.id]
    );
    const kbUsers = [...new Set([...kbDirect, ...kbRows.rows.map(row => row.user_id)])];
    const effective = [...new Set([...manual, ...kbUsers])];
    const candidates = await pool.query("SELECT id,username,display_name,department,role,active FROM users WHERE active=TRUE ORDER BY department,username");
    res.json({
      document_id: req.params.id,
      filename: document.filename,
      department: document.department,
      manual_allowed_users: manual,
      kb_allowed_users: kbUsers,
      allowed_users: effective,
      candidates: candidates.rows
    });
  } catch (error) { next(error); }
});

app.put("/api/documents/:id/access", requireAuth, requireRole("admin", "maintainer"), async (req, res, next) => {
  try {
    // 维护员只能改本部门（或 public、或本部门知识库关联）文档的权限，避免跨部门改 ACL。
    if (req.user.role !== "admin") {
      const document = await ragRequest(`/documents/${req.params.id}?user_id=${encodeURIComponent(req.user.id)}&department=${encodeURIComponent(req.user.department)}&role=admin`);
      const linked = await pool.query(
        "SELECT 1 FROM kb_documents d JOIN knowledge_bases k ON k.id=d.knowledge_base_id WHERE d.document_id=$1 AND k.department=$2 LIMIT 1",
        [req.params.id, req.user.department]
      );
      if (document.department !== req.user.department && document.department !== "public" && !linked.rowCount) {
        return res.status(403).json({ error: "维护员不能修改其他部门文档的权限" });
      }
    }
    res.json(await ragRequest(`/documents/${req.params.id}/access`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowed_users: req.body?.allowed_users || [] }) }));
  } catch (error) { next(error); }
});

app.post("/api/documents/:id/retry", requireAuth, requireRole("admin", "maintainer"), async (req, res, next) => {
  try { res.json(await ragRequest(`/documents/${req.params.id}/retry?role=${req.user.role}`, { method: "POST" })); } catch (error) { next(error); }
});

app.put("/api/documents/:id", requireAuth, requireRole("admin", "maintainer"), limitUploadRequest, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请选择要替换的文档文件" });
    // P0修复5：先从 RAG 取得目标元数据，再在业务层确认维护员所属部门后才转发更新。
    const document = await ragRequest(`/documents/${req.params.id}?user_id=${encodeURIComponent(req.user.id)}&department=${encodeURIComponent(req.user.department)}&role=admin`);
    if (req.user.role !== "admin") {
      const linked = await pool.query(
        "SELECT 1 FROM kb_documents d JOIN knowledge_bases k ON k.id=d.knowledge_base_id WHERE d.document_id=$1 AND k.department=$2 LIMIT 1",
        [req.params.id, req.user.department]
      );
      // P0修复5：维护员只能更新自己部门或 public 文档，或自己部门知识库关联的文档
      if (document.department !== req.user.department && document.department !== "public" && !linked.rowCount) {
        return res.status(403).json({ error: "维护员不能更新其他部门文档" });
      }
    }
    const form = new FormData();
    const content = await fs.promises.readFile(req.file.path);
    form.append("file", new Blob([content], { type: req.file.mimetype }), req.file.originalname);
    form.append("role", req.user.role);
    form.append("department", document.department);
    if (req.body.sensitivity) form.append("sensitivity", req.body.sensitivity);
    if (req.body.allowed_users !== undefined) form.append("allowed_users", req.body.allowed_users);
    res.json(await ragRequest(`/documents/${req.params.id}`, { method: "PUT", body: form }));
  } catch (error) { next(error); }
  finally { if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {}); }
});

app.delete("/api/documents/:id", requireAuth, requireRole("admin", "maintainer"), async (req, res, next) => {
  try {
    const deleted = await ragRequest(`/documents/${req.params.id}?role=${req.user.role}`, { method: "DELETE" });
    await pool.query("DELETE FROM kb_documents WHERE document_id=$1", [req.params.id]);
    res.json(deleted);
  } catch (error) { next(error); }
});

app.post("/api/chat/sessions", requireAuth, async (req, res, next) => {
  try {
    const title = String(req.body?.title || "新会话").slice(0, 120);
    const result = await pool.query("INSERT INTO chat_sessions (user_id, title) VALUES ($1,$2) RETURNING *", [req.user.id, title]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get("/api/chat/sessions", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM chat_sessions WHERE user_id=$1 ORDER BY updated_at DESC", [req.user.id]);
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.patch("/api/chat/sessions/:id", requireAuth, async (req, res, next) => {
  try {
    const title = String(req.body?.title || "").trim().slice(0, 120);
    if (!title) return res.status(400).json({ error: "会话标题不能为空" });
    const result = await pool.query("UPDATE chat_sessions SET title=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *", [title, req.params.id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "会话不存在" });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.delete("/api/chat/sessions/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM chat_sessions WHERE id=$1 AND user_id=$2 RETURNING id", [req.params.id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "会话不存在" });
    res.json({ id: req.params.id, status: "deleted" });
  } catch (error) { next(error); }
});
app.get("/api/chat/sessions/:id/messages", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT role, content, trace_id, sources, created_at FROM chat_messages WHERE session_id=$1 AND user_id=$2 ORDER BY id", [req.params.id, req.user.id]);
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

// 每轮聊天先保存用户消息，再调用 RAG Agent，最后保存回答和引用。
app.post("/api/chat/sessions/:id/messages", requireAuth, async (req, res, next) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content || content.length > 4000) return res.status(400).json({ error: "消息不能为空且不能超过 4000 个字符" });
    const session = await pool.query("SELECT id FROM chat_sessions WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
    if (!session.rowCount) return res.status(404).json({ error: "会话不存在" });
    await pool.query("INSERT INTO chat_messages (session_id,user_id,role,content) VALUES ($1,$2,'user',$3)", [req.params.id, req.user.id, content]);
    const history = await pool.query("SELECT role, content FROM chat_messages WHERE session_id=$1 AND role IN ('user','assistant') ORDER BY id DESC LIMIT 12", [req.params.id]);
    const messages = history.rows.reverse().slice(0, -1);
    const answer = await ragRequest("/agent/query", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: content, user_id: req.user.id, department: req.user.department, role: req.user.role, intent: "knowledge", history: messages })
    });
    await pool.query("INSERT INTO chat_messages (session_id,user_id,role,content,trace_id,sources) VALUES ($1,$2,'assistant',$3,$4,$5)", [req.params.id, req.user.id, answer.answer || "", answer.trace_id || null, JSON.stringify(answer.sources || [])]);
    await pool.query("UPDATE chat_sessions SET updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.json({ answer: answer.answer, trace_id: answer.trace_id, sources: answer.sources || [], history_count: history.rowCount });
  } catch (error) { next(error); }
});

// 原生模型 token 流：直接代理 RAG 服务的 /query/stream（SSE），逐块转发给浏览器。
// 与旧实现的区别：旧版本是"先等完整答案、再按 80 字切块"的伪流式，首字延迟等于整段生成时间；
// 现在改为真正的边生成边下发，首字延迟只取决于模型首个 token。
app.get("/api/chat/sessions/:id/stream", requireAuth, async (req, res, next) => {
  try {
    const content = String(req.query.content || "").trim();
    if (!content || content.length > 4000) return res.status(400).json({ error: "content 必填且不能超过 4000 个字符" });
    const session = await pool.query("SELECT id FROM chat_sessions WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
    if (!session.rowCount) return res.status(404).json({ error: "会话不存在" });
    // 先落库用户消息，保证即使模型报错也能看到提问记录。
    await pool.query("INSERT INTO chat_messages (session_id,user_id,role,content) VALUES ($1,$2,'user',$3)", [req.params.id, req.user.id, content]);
    const history = await pool.query("SELECT role,content FROM chat_messages WHERE session_id=$1 AND role IN ('user','assistant') ORDER BY id DESC LIMIT 12", [req.params.id]);

    const upstream = await fetch(`${RAG_BASE_URL}/query/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": process.env.INTERNAL_API_KEY || "" },
      body: JSON.stringify({
        query: content,
        user_id: req.user.id,
        department: req.user.department,
        role: req.user.role,
        knowledge_base_id: req.query.knowledge_base_id || null,
        history: history.rows.reverse().slice(0, -1)
      })
    });
    if (!upstream.ok) {
      const payload = await upstream.json().catch(() => ({}));
      return res.status(upstream.status).json({ error: payload.detail || payload.error || "RAG 流式接口失败" });
    }

    res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();

    // 边转发边累积答案与引用，流结束后一次性写入 chat_messages。
    let answerText = "";
    let traceId = null;
    let sources = [];
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of upstream.body) {
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;
      // 逐条 SSE 报文（以空行分隔）解析，避免把半条事件当成完整事件。
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const raw of events) {
        if (!raw.trim()) continue;
        const dataLine = raw.split("\n").find(line => line.startsWith("data: "));
        if (!dataLine) continue;
        let data = {};
        try { data = JSON.parse(dataLine.slice(6)); } catch { continue; }
        if (raw.startsWith("event: meta")) { traceId = data.trace_id || null; sources = data.sources || []; }
        if (raw.startsWith("event: token")) answerText += data.text || "";
      }
      // 原样转发，前端解析逻辑不需要改变。
      res.write(text);
    }
    await pool.query("INSERT INTO chat_messages (session_id,user_id,role,content,trace_id,sources) VALUES ($1,$2,'assistant',$3,$4,$5)", [req.params.id, req.user.id, answerText, traceId, JSON.stringify(sources)]);
    await pool.query("UPDATE chat_sessions SET updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.end();
  } catch (error) {
    if (res.headersSent) { res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`); res.end(); return; }
    next(error);
  }
});

app.post("/api/feedback", requireAuth, async (req, res, next) => {
  try {
    const { session_id, trace_id, rating, comment = "" } = req.body || {};
    if (!session_id || !trace_id || !Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: "session_id、trace_id 和 1-5 的 rating 必填" });
    const ownedAnswer = await pool.query("SELECT 1 FROM chat_messages WHERE session_id=$1 AND user_id=$2 AND role='assistant' AND trace_id=$3 LIMIT 1", [session_id, req.user.id, trace_id]);
    if (!ownedAnswer.rowCount) return res.status(404).json({ error: "找不到当前用户对应的回答记录" });
    const result = await pool.query("INSERT INTO feedback (user_id,session_id,trace_id,rating,comment) VALUES ($1,$2,$3,$4,$5) RETURNING *", [req.user.id, session_id || null, trace_id, rating, String(comment).slice(0, 2000)]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.post("/api/evaluation/matrix", requireAuth, requireRole("admin", "auditor"), async (req, res, next) => {
  try {
    const payload = { user_id: req.user.id, department: req.user.department, role: req.user.role, top_k: req.body?.top_k || 5 };
    res.json(await ragRequest("/evaluation/matrix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
  } catch (error) { next(error); }
});

app.get("/api/security/injection-patterns", requireAuth, requireRole("admin", "auditor"), async (req, res, next) => {
  try { res.json(await ragRequest("/security/injection-patterns")); } catch (error) { next(error); }
});

app.get("/api/documents/:id/security", requireAuth, async (req, res, next) => {
  try { res.json(await ragRequest(`/documents/${req.params.id}/security`)); } catch (error) { next(error); }
});
app.get("/api/admin/stats", requireAuth, requireRole("admin", "auditor"), async (req, res, next) => {
  try {
    const [docs, sessions, feedback] = await Promise.all([
      ragRequest(`/documents?user_id=${req.user.id}&department=${req.user.department}&role=${req.user.role}`),
      pool.query("SELECT COUNT(*)::int AS count FROM chat_sessions"),
      pool.query("SELECT COUNT(*)::int AS count, COALESCE(ROUND(AVG(rating),2),0) AS average FROM feedback")
    ]);
    const byStatus = docs.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
    res.json({ documents: { total: docs.length, by_status: byStatus }, sessions: sessions.rows[0], feedback: feedback.rows[0] });
  } catch (error) { next(error); }
});

app.get("/api/admin/feedback/export", requireAuth, requireRole("admin", "auditor"), async (req, res, next) => {
  try {
    const result = await pool.query("SELECT created_at,user_id,session_id,trace_id,rating,comment FROM feedback ORDER BY created_at DESC");
    const cell = value => {
      const text = String(value ?? "");
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = ["created_at,user_id,session_id,trace_id,rating,comment", ...result.rows.map(row => [row.created_at, row.user_id, row.session_id, row.trace_id, row.rating, row.comment].map(cell).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=feedback.csv");
    res.send(`\\uFEFF${csv}`);
  } catch (error) { next(error); }
});

app.get("/api/admin/knowledge-bases/:id/members", requireAuth, requireRole("admin", "maintainer"), async (req, res, next) => {
  try {
    const result = await pool.query("SELECT u.id,u.username,u.display_name,u.department FROM kb_members m JOIN users u ON u.id=m.user_id WHERE m.knowledge_base_id=$1 ORDER BY u.display_name", [req.params.id]);
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.use(express.static(path.join(__dirname, "public")));
app.use(stage4ErrorHandler);

// 启动前创建阶段 4 的表；如果数据库不可用，直接退出并让 Docker 重启策略接管。
initStage4Database()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Application listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Stage 4 database initialization failed", error);
    process.exit(1);
  });








