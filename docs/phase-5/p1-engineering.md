# P1 工程化改进记录

## 已完成

- 集中配置：`rag/settings.py` 在启动时读取并缓存配置，检索阈值、模型、切分和上传上限统一由 Settings 管理。
- 数据迁移基础：`migrations/0001_p1_document_acl.sql` 记录 ACL 和知识库字段变更；运行时保留兼容迁移。
- 前端拆分：`app/public/index.html` 只保留页面结构，交互逻辑拆到 `app/public/app.js`。
- 错误边界：Express 错误响应仅返回 trace_id，内部细节写日志；RAG 使用 logging 输出结构化事件。
- CI 和测试：新增 `.github/workflows/ci.yml`、`tests/test_rag_units.py`、`requirements-dev.txt`、`Makefile` 和 npm test。
- 评测产物：`/evaluation/run` 将结果写入 `/service/evals/reports` 并返回 report_path。
- 体验接口：新增密码修改、文档手工 ACL 代理和知识库范围过滤字段。
- 开源文件：补充 README、LICENSE、CONTRIBUTING、CHANGELOG、SECURITY 和 ADR/迁移目录。

## 验证

- `node --check app/server.js` 通过。
- `python -m py_compile rag/main.py rag/settings.py rag/worker.py` 通过。
- `docker compose config --quiet` 通过。
- Docker Compose 重建后 app、rag、worker、db、qdrant、ollama 均运行，`/health` 返回 `{"status":"ok"}`。

## 后续建议

集成测试、Playwright 端到端、SSE 流式回答、cross-encoder 重排和正式中文分词仍适合单独迭代，当前 P1 基础已经具备可持续扩展的目录、配置和 CI 入口。
