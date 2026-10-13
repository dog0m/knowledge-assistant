# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [Unreleased]

### Added
- 文档异步入库队列与独立 worker 服务
- 内部服务共享令牌鉴权（INTERNAL_API_KEY）
- 向量集合按模型、维度、切分策略隔离
- 文档 ACL 来源分离（manual_allowed_users / kb_allowed_users）
- 文档版本化原子更新
- 文件 MIME、文件头、大小与解压尺寸校验
- 提示注入扫描、风险标签与 UNTRUSTED_SOURCE 上下文隔离
- RAG 量化矩阵评测（fixed/paragraph × vector/hybrid × rerank）与 JSON/Markdown/SVG 报告
- 会话管理、密码修改、SSE 聊天接口
- 知识库范围检索（knowledge_base_id）
- jieba 中文分词
- pytest 单元测试、CI 工作流、Makefile
- README、LICENSE、CONTRIBUTING、SECURITY、ADR
- 原生模型 token 流：POST /query/stream 与 GET /api/chat/sessions/:id/stream 逐 token 转发
- 多副本会话存储（app/session-store.js）：会话与登录失败计数默认落 PostgreSQL
- 文档 ACL 可视化编辑器：GET /api/documents/:id/access + 前端勾选面板
- Testcontainers 全链路集成测试（真实 PostgreSQL / Qdrant）与独立 CI integration job
- Node 会话存储单元测试（node --test tests/session_store.test.js）

### Changed
- RAG 配置集中到 rag/settings.py
- Express 错误响应只返回 trace_id，内部细节写日志
- 前端脚本从 index.html 拆分到 app.js
- 聊天流式接口由"整段生成后按 80 字切块"改为真正的边生成边下发
- compose.yml 移除固定 container_name，支持 docker compose up --scale 水平扩展
- 登录限流从进程内 Map 迁移到共享存储，多副本下限流生效
- 矩阵报告 Markdown 生成改用显式变量，兼容 Python 3.11/3.12 解析器

### Security
- 移除无关第三方工具目录，收紧 .gitignore
- 轮换示例环境中的密钥占位方式
