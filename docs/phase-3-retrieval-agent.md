# 阶段 3：检索质量与 Agent

本阶段在 `rag` 服务内增加检索对比、受控 Agent 和固定评测。数据库容器不需要重启；代码和依赖更新后需要重新构建并重启 `rag` 容器。

## 新增接口

| 接口 | 作用 |
|---|---|
| `POST /agent/query` | 通过 LangGraph 路由到知识库问答或只读统计工具 |
| `GET /agent/traces/{trace_id}` | 查看一次 Agent 调用的路由、工具、错误和完成事件 |
| `GET /evaluation/set` | 查看固定评测集和 SHA-256 版本指纹 |
| `POST /evaluation/run` | 重复运行固定评测集，比较 vector/hybrid 检索 |
| `GET /evaluation/chunking` | 对已入库文档比较 fixed/paragraph 切分块数量 |

## LangGraph 路由

Agent 只允许两个工具：

- `knowledge_search`：进行权限过滤后的向量或混合检索，并生成带来源回答。
- `read_only_document_stats`：只读查询当前部门的文档状态和块数量。

普通用户调用 `intent=info` 会收到 403；维护员、管理员和审计员才可以使用只读统计工具。代码没有开放任意 SQL、写入业务数据或任意工具名。

每个请求最多调用 `AGENT_MAX_TOOL_CALLS` 次工具，默认 3 次。请求的 `query`、用户、部门、角色、意图和 `top_k` 都有 Pydantic 参数校验。

## 检索质量

- `RAG_CHUNK_STRATEGY=fixed`：固定字符窗口，作为稳定基线。
- `RAG_CHUNK_STRATEGY=paragraph`：优先按 Markdown 标题和段落切分，长段落再按窗口切分。
- `RAG_RETRIEVAL_MODE=vector`：只使用 Qdrant 向量召回。
- `RAG_RETRIEVAL_MODE=hybrid`：向量分数与关键词覆盖率合并，再加短语命中加分。

当前混合检索的关键词部分使用 Qdrant payload 扫描，适合阶段 3 的小规模试点。文档量很大时，应换成 PostgreSQL Full Text Search 或独立搜索引擎。

## 固定评测

评测集在 `rag/eval_set.json`，当前包含事实题、跨文档题和无答案题。每次运行返回数据集 SHA-256，确保不同时间运行的是同一版本。

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8090/evaluation/run" `
  -ContentType "application/json" `
  -Body (@{user_id="demo-user";department="platform";role="user";modes=@("vector","hybrid")} | ConvertTo-Json)
```

查看 Agent 调用链：

```powershell
Invoke-RestMethod "http://localhost:8090/agent/traces/<trace_id>"
```

调用知识库 Agent：

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8090/agent/query" `
  -ContentType "application/json" `
  -Body (@{query="What is a Docker container?";user_id="demo-user";department="platform";role="user";intent="knowledge"} | ConvertTo-Json)
```

调用只读统计工具（需要管理员或维护员角色）：

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8090/agent/query" `
  -ContentType "application/json" `
  -Body (@{query="请统计当前部门文档数量和索引状态";user_id="demo-admin";department="platform";role="admin";intent="info"} | ConvertTo-Json)
```

比较切分策略：

```powershell
Invoke-RestMethod "http://localhost:8090/evaluation/chunking"
```

