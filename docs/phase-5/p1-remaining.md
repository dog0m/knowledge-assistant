# P1 剩余能力迭代

已实现：
- SSE：`GET /api/chat/sessions/:id/stream` 发送 meta、token、done 事件；当前 RAG 生成端完整返回后由 app 分块发送。
- 会话管理：支持会话重命名、删除、修改密码。
- 知识库范围：RAG 请求支持 knowledge_base_id，Qdrant payload 和过滤器参与范围限制。
- 中文检索：优先使用 jieba，依赖不可用时回退单字切分。
- 文档 ACL：前端文档表提供“权限”入口，调用手工 ACL API，并与知识库 ACL 分开合并。
- E2E：tests/e2e 提供 Playwright 配置、登录页和健康检查冒烟用例。

仍可继续：原生模型 token 流、cross-encoder 重排、Testcontainers 全链路集成测试和完整 ACL 可视化编辑器。
