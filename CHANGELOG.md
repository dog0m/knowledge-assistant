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

### Changed
- RAG 配置集中到 rag/settings.py
- Express 错误响应只返回 trace_id，内部细节写日志
- 前端脚本从 index.html 拆分到 app.js

### Security
- 移除无关第三方工具目录，收紧 .gitignore
- 轮换示例环境中的密钥占位方式
