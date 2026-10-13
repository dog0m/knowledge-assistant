// tests/session_store.test.js
//
// 会话存储的单元测试（Node 内置测试运行器，零额外依赖）。
// 运行方式：node --test tests/session_store.test.js
//
// 重点验证多副本场景下最关键的两件事：
//   1. 会话令牌只以哈希形式保存，解析时能用明文令牌找回 user_id
//   2. 登录失败计数达到上限后会锁定，成功登录会清零

const test = require("node:test");
const assert = require("node:assert");
const { createSessionStore, hashToken } = require("../app/session-store.js");

test("内存会话存储：创建、解析、删除", async () => {
  const store = createSessionStore({ kind: "memory" });
  const token = await store.createSession("user-1");
  assert.ok(token && token.length >= 32, "应返回足够长的随机会话令牌");
  assert.deepStrictEqual(await store.resolveSession(token), { user_id: "user-1" });
  await store.deleteSession(token);
  assert.strictEqual(await store.resolveSession(token), null);
});

test("内存会话存储：未知令牌返回 null", async () => {
  const store = createSessionStore({ kind: "memory" });
  assert.strictEqual(await store.resolveSession("not-a-real-token"), null);
});

test("登录失败计数达到上限后进入锁定状态", async () => {
  const store = createSessionStore({ kind: "memory" });
  const key = "127.0.0.1:alice";
  for (let i = 0; i < 9; i += 1) await store.recordLoginFailure(key);
  assert.strictEqual(await store.isLoginBlocked(key), false, "未达上限不应锁定");
  await store.recordLoginFailure(key);
  assert.strictEqual(await store.isLoginBlocked(key), true, "第 10 次失败后应锁定");
  await store.clearLoginFailures(key);
  assert.strictEqual(await store.isLoginBlocked(key), false, "清零后应解除锁定");
});

test("删除某用户的全部会话（改密后强制下线）", async () => {
  const store = createSessionStore({ kind: "memory" });
  const first = await store.createSession("user-2");
  const second = await store.createSession("user-2");
  const other = await store.createSession("user-3");
  await store.deleteSessionsForUser("user-2");
  assert.strictEqual(await store.resolveSession(first), null);
  assert.strictEqual(await store.resolveSession(second), null);
  assert.ok(await store.resolveSession(other), "其他用户的会话不应被影响");
});

test("令牌哈希是稳定且不可逆的", () => {
  const token = "abc123";
  assert.strictEqual(hashToken(token), hashToken(token));
  assert.notStrictEqual(hashToken(token), token);
  assert.strictEqual(hashToken(token).length, 64, "sha256 十六进制长度应为 64");
});
