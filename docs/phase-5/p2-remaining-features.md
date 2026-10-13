# 补齐的四项"未实现"能力（实测记录）

对应 README 之前列出的四项缺口，现已全部实现并验证。
环境：Windows + Docker Desktop，Compose 栈 `db / qdrant / ollama / rag / worker / app`。

| 能力 | 关键文件 | 验证方式 |
| --- | --- | --- |
| 原生模型 token 流 | `rag/main.py`、`app/server.js`、`app/public/app.js` | SSE 事件计数 + 落库检查 |
| Testcontainers 全链路集成测试 | `tests/integration/` | `pytest -m integration` |
| 文档 ACL 可视化编辑器 | `app/server.js`、`app/public/index.html`、`app/public/app.js` | API + 数据库 ACL 来源 |
| 多副本会话存储 | `app/session-store.js`、`compose.yml` | 跨副本登录令牌复用 |

---

## 1. 原生模型 token 流

### 实现要点

- RAG 侧新增 `POST /query/stream`，返回 `text/event-stream`。
- 事件顺序：`meta`（trace_id + 引用来源）→ `token`（文本增量，多条）→ `done`；异常时为 `error`。
- 用 `httpx` 的流式请求直接转发上游增量：
  - Ollama：NDJSON（每行一个 JSON，`done=true` 结束）
  - OpenAI：SSE（`data: {...}`，`data: [DONE]` 结束）
- 非流式与流式共用 `build_answer_messages()`，证据边界（UNTRUSTED_SOURCE）不会漂移。
- app 侧 `GET /api/chat/sessions/:id/stream` 改为代理 RAG 的 SSE，边转发边累积答案与引用，
  流结束后一次性写入 `chat_messages`。

### 实测（`GET /api/chat/sessions/<id>/stream?content=Docker 容器是什么？`）

```
first-byte after 8983 ms
total 18618 ms
event counts:
  event: meta  x1
  event: token x299
  event: done  x1
```

首字节 8.98s、整段 18.6s：token 事件在整段生成结束前就开始下发，说明是真实流式而非"生成完再切块"。

落库校验（`GET /api/chat/sessions/<id>/messages`）：

```
role=user      trace=            srcs=0 len=13
role=assistant trace=55ee545f-…  srcs=5 len=497
```

### 回归测试

`tests/test_streaming_and_store.py` 覆盖 `serialize_source` / `sse_event` / `build_answer_messages`
（引用字段白名单、SSE 报文格式、历史截断到 12 条、未知角色过滤）。

---

## 2. Testcontainers 全链路集成测试

### 实现要点

- `tests/integration/conftest.py` 启动真实 `postgres:16-alpine` 与 `qdrant/qdrant:v1.19.1` 容器。
- 关键点：测试模块在收集阶段可能已导入过 `rag.main`，而 `settings` 是 `@lru_cache`、Qdrant 客户端在模块级创建。
  fixture 会彻底清掉 `rag` 包缓存（含父包属性）后用 `importlib` 重新导入，确保连到容器地址。
- Embedding 被替换为确定性 8 维实现（Ollama 不便在 CI 起大模型），数据库 / 队列 / Qdrant 全部真实。
- Docker 可用性用 `docker_available()` 探测（`DockerClient().client.ping()`），
  而不是只检查 `docker` 可执行文件——容器内挂 socket 时同样能跑。

### 覆盖场景

| 用例 | 验收点 |
| --- | --- |
| `test_index_and_retrieve_returns_locatable_source` | 能返回可定位来源（文件名 + 页码/章节） |
| `test_permission_filter_blocks_other_department` | 不同权限用户不能互相读取受限文档 |
| `test_delete_removes_document_from_retrieval` | 删除后旧内容不再被检索 |
| `test_version_update_keeps_only_latest` | 更新后只保留最新版本 |
| `test_manual_acl_grants_cross_department_access` | 手工 ACL 可跨部门授权 |
| `test_injection_flagging_marks_suspicious_document` | 入库阶段对提示注入打标签 |

### 实测

```
tests/integration/test_full_chain.py::test_index_and_retrieve_returns_locatable_source PASSED
tests/integration/test_full_chain.py::test_permission_filter_blocks_other_department PASSED
tests/integration/test_full_chain.py::test_delete_removes_document_from_retrieval PASSED
tests/integration/test_full_chain.py::test_version_update_keeps_only_latest PASSED
tests/integration/test_full_chain.py::test_manual_acl_grants_cross_department_access PASSED
tests/integration/test_full_chain.py::test_injection_flagging_marks_suspicious_document PASSED
================ 6 passed, 24 deselected ================
```

完整套件：`30 passed`（24 单元 + 6 集成）。

---

## 3. 文档 ACL 可视化编辑器

### 实现要点

- 新增 `GET /api/documents/:id/access`：一次返回 `manual_allowed_users`、`kb_allowed_users`
  （含文档所属知识库成员）与候选用户列表。
- `PUT /api/documents/:id/access` 增加维护员部门校验，避免跨部门改 ACL。
- 前端文档表格的"权限"按钮打开勾选面板，支持按用户名/姓名/部门搜索；
  知识库派生的授权置灰只读，手工勾选保存为 manual ACL。

### 实测

打开编辑器返回：

```
filename=新建 文本文档.txt dept=kb_2cc4d38c-… 
manual=0 kb=3 effective=3 candidates=5
```

勾选 2 人并保存后：

```
PUT result: {"id":"de2e1571-…","allowed_user_count":2}
after: manual=2 kb=3 effective=5
```

数据库 ACL 来源（`allowed_users = manual ∪ kb`）：

```
manual_allowed_users = ["6f8502bc-…", "0685365e-…"]
kb_allowed_users     = []
allowed_users        = ["0685365e-…", "6f8502bc-…"]
```

前端 Playwright 用例 `tests/e2e/specs/acl-editor.spec.js` 通过。

---

## 4. 多副本会话存储

### 实现要点

- `app/session-store.js` 抽象会话与登录失败计数，`SESSION_STORE=postgres`（默认）或 `memory`。
- PostgreSQL 后端复用 `sessions` 表，并新增 `login_failures` 表做跨副本限流。
- `compose.yml` 移除固定 `container_name`，支持 `docker compose up --scale app=3`。
- 登出 / 改密分别调用 `deleteSession` / `deleteSessionsForUser`，改密后所有旧会话立即失效。

### 实测（主副本 :8080，测试副本 app-replica-test）

1. 在测试副本登录拿到令牌，用该令牌请求主副本：

```
replica token len=64
CROSS-REPLICA OK: admin / admin
```

2. 在测试副本连续 10 次错误登录，第 11 次被锁定：

```
first 10 attempts: 401,401,401,401,401,401,401,401,401,401
11th attempt: 429 {"error":"登录失败次数过多，请 10 分钟后重试"}
```

3. 计数存在共享的 PostgreSQL 表中（而不是进程内存）：

```
   failure_key    | count | active
------------------+-------+--------
 127.0.0.1:lockme |    10 | t
```

4. 用同一个限流 key 请求主副本，同样被拒绝：

```
PRIMARY app status: 429 {"error":"登录失败次数过多，请 10 分钟后重试"}
```

### 回归测试

`node --test tests/session_store.test.js` → 5 passed：
会话创建/解析/删除、未知令牌、失败计数达上限后锁定、改密强制下线、令牌哈希稳定性。

---

## 附带修复

- `rag/main.py` 矩阵报告 Markdown 生成改用显式变量，兼容 Python 3.11/3.12 解析器
  （原嵌套引号 f-string 只能在 3.12+ 解析）。
- `rag/requirements-dev.txt` 注释改为 ASCII，避免 Windows GBK 环境下 pip 解析失败。
- `app/Dockerfile` 补齐 `session-store.js` 拷贝（缺失会导致容器启动即 MODULE_NOT_FOUND）。
- `tests/e2e/specs/main-flow.spec.js` 提问前先新建空会话，避免命中历史回答导致断言不确定。
