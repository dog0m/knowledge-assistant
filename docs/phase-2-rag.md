# 阶段 2：文档入库与基础 RAG

## Embedding 模型建议

默认模型是 `bge-m3`。它支持中文、多语言和较长文本，适合当前技术支持文档与后续中文企业文档。你的 RTX 3060 6 GB 显存可以先用于小规模试点；Embedding 服务和生成模型不要同时加载过多模型。

在 Ollama 中准备模型：

```powershell
docker exec myapp-ollama ollama pull bge-m3
```

如果只想使用更小的模型，可以把 `.env` 的 `OLLAMA_EMBED_MODEL` 改为 `nomic-embed-text`，但需要重新建立 Qdrant collection，并重新评测中文检索质量。

## 服务和接口

Python 服务目录为 `rag/`，Compose 服务名为 `rag`，宿主机端口为 `8090`。

| 接口 | 用途 |
|---|---|
| `GET /health` | 检查 PostgreSQL 连接和索引配置 |
| `POST /documents` | 上传 PDF、DOCX、Markdown 或 TXT，并立即解析索引 |
| `POST /documents/batch` | 一次上传多个 PDF、DOCX、Markdown 或 TXT；每个文件独立返回结果 |
| `GET /documents` | 按用户、部门和角色列出有权文档 |
| `GET /documents/{id}` | 查看文档状态和错误信息 |
| `PUT /documents/{id}` | 替换文件并增加版本号，删除旧版本向量后重新索引 |
| `POST /documents/{id}/retry` | 对失败文档重试索引，最多 3 次 |
| `DELETE /documents/{id}` | 删除原文件和 Qdrant 向量 |
| `POST /search` | 只返回权限过滤后的检索片段 |
| `POST /query` | 返回回答、证据是否充分和可定位引用 |

## 手动验证示例

启动服务：

```powershell
docker compose up -d --build rag
```

上传文档：

```powershell
curl.exe -X POST http://localhost:8090/documents `
  -F "file=@docs/phase-0/sample-data/technical-support/docker-what-is-a-container.md" `
  -F "department=platform" `
  -F "sensitivity=L0" `
  -F "user_id=demo-admin"
```

批量上传文档：

```powershell
curl.exe -X POST http://localhost:8090/documents/batch `
    -F "files=@docs/phase-0/sample-data/technical-support/docker-what-is-a-registry.md" `
    -F "files=@docs/phase-0/sample-data/technical-support/docker-what-is-an-image.md" `
    -F "files=@docs/phase-0/sample-data/technical-support/fastapi-first-steps.md" `
    -F "files=@docs/phase-0/sample-data/technical-support/fastapi-request-body.md" `
    -F "files=@docs/phase-0/sample-data/technical-support/ollama-readme.md" `
    -F "files=@docs/phase-0/sample-data/technical-support/pgvector-readme.md" `
    -F "files=@docs/phase-0/sample-data/technical-support/qdrant-readme.md" `
    -F "department=platform" `
    -F "sensitivity=L0" `
    -F "user_id=demo-admin"
```

批量接口会返回 `total`、`succeeded`、`failed` 和 `results`。单个文件解析或索引失败时，其结果会标记为 `failed`，其他文件仍会继续处理；之后可以根据返回的文档 ID 调用重试接口。

查询并带引用回答：

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8090/query" `  -ContentType "application/json" `  -Body (@{query="What is a Docker container?";user_id="demo-user";department="platform";role="user"} | ConvertTo-Json)
```

权限不足：

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8090/query" `  -ContentType "application/json" `  -Body (@{query="What is a Docker container?";user_id="stranger";department="hr";role="user"} | ConvertTo-Json)
```

没有相关资料：

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8090/query" `  -ContentType "application/json" `  -Body (@{query="What is the capital of Mars";user_id="demo-user";department="platform";role="user"} | ConvertTo-Json)
```

权限测试：将上传时的 `department` 改成 `private-team`，普通用户使用 `department=platform` 查询时不应得到该文档片段；`role=admin` 可以查询。

更新测试：使用 `PUT /documents/{id}` 并提交 `role=maintainer`，会增加版本号；删除和重试也必须使用 `role=maintainer` 或 `role=admin`。删除时会同时删除文件和该文档的 Qdrant 向量，旧片段不会继续返回。
