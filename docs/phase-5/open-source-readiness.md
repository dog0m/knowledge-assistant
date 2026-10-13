# 开源前整改执行记录

执行范围：阶段 A（阻塞项）、B（工程配置）、C（测试）、D（CI）。

## 阶段 A：阻塞项清理

| 项 | 内容 | 结果 |
| --- | --- | --- |
| A1 | 删除无关第三方工具目录与脚本 | 已删除 .impacket-runtime311 / .impacket-venv / .impacket-venv311 / artifacts / .package-runner.txt / install-security-tools.ps1 / move_8021x_to_ruijie.ps1 |
| A2 | 扩充 .gitignore | 覆盖 .env、备份、缓存、.impacket-venv*、artifacts、playwright-report、evals |
| A3 | 密钥轮换 | POSTGRES_PASSWORD、ADMIN_INITIAL_PASSWORD、INTERNAL_API_KEY 重新生成；OPENAI_API_KEY 清空待填 |
| A4 | Git 初始化与密钥扫描 | git init 完成；暂存文件无密钥命中；.env 未被追踪 |
| A5 | 重写 README | 含功能、架构图、快速开始、配置表、评测结果、已实现/未实现、技术选型 |
| A6 | 补全 LICENSE | 完整 MIT 文本 |
| A7 | 补全 CONTRIBUTING / CHANGELOG / SECURITY | 内容可执行 |
| A8 | 文档脱敏 | 服务器资源盘点改为模板，移除真实机型与主机名 |

## 阶段 B：工程配置

| 项 | 内容 | 结果 |
| --- | --- | --- |
| B1 | 固定镜像版本 | qdrant/qdrant:v1.19.1、ollama/ollama:0.35.0 |
| B2 | 移除 app 多余 GPU 配置 | app 服务不再声明 gpus，镜像改为 app/Dockerfile 的 node:22-alpine |
| B3 | 修复 Qdrant 版本不匹配 | qdrant-client 升级到 1.19.1，启动日志不再报版本不兼容 |
| B4 | 修复 cookie 死代码 | 引入 cookie-parser 并注册中间件 |
| B5 | 拆分依赖 | 生产 requirements 移除 pytest/ruff；测试依赖进 requirements-dev |
| B6 | 完善 .env.example | 分区说明、占位符、无真实值 |
| B7 | 标注端口暴露 | Qdrant 6333 注释为本地调试用 |

## 阶段 C：测试

| 项 | 内容 | 结果 |
| --- | --- | --- |
| C1 | 扩展单元测试 | 24 个用例通过，覆盖切分、ACL 合并、意图路由、注入扫描、重排、SVG |
| C2 | 权限集成测试 | 普通用户建库/管成员/读统计均 403；跨部门文档 404；成员增删即时生效 |
| C3 | 文档流水线测试 | 上传 queued -> processing -> ready；chunk_count 正确 |
| C4 | 更新与删除测试 | 更新后仅剩 v2 向量；删除后无残留点 |
| C5 | 提示注入端到端 | 4 条规则命中；真实密钥未泄露 |
| C6 | Playwright 端到端 | 登录页/健康检查/未登录保护 + 主流程用例 |
| C7 | 评测矩阵纳入入口 | POST /api/evaluation/matrix 需鉴权，未登录返回 401 |

## 阶段 D：CI 与自动化

| 项 | 内容 | 结果 |
| --- | --- | --- |
| D1 | CI 静态检查 | 增加 py_compile、node --check、docker compose config |
| D2 | 依赖安全扫描 | pip-audit 步骤 |
| D3 | 密钥扫描 | gitleaks-action + .gitleaks.toml 允许列表 |
| D4 | 评测产物 | 新增 scripts/run-evaluation.ps1，CI 可调用 |

## 发现的问题与后续

1. 小模型（llama3.2:1b）面对注入时会**编造**一段假的"系统提示词和 API Key"。真实密钥未泄露，但回答不可信。建议生产使用更强的生成模型，并在评测中加入"编造检测"。
2. OPENAI_API_KEY 已被清空，若继续用 OpenAI 网关需重新填入新密钥；当前已切换到 ollama 后端。
3. 生产镜像不再包含 pytest，容器内跑测试需先安装 pytest。
4. 集成测试目前以脚本方式验证，尚未落成 testcontainers 自动化用例，属于后续工作。
5. 首次构建会拉取固定版本镜像与 Python 依赖，耗时较长。

## 最终验证

- node --check app/server.js / app/public/app.js：通过
- python -m py_compile：通过
- docker compose config --quiet：通过
- 容器内 pytest：24 passed
- /health：{"status":"ok"}
- 服务状态：app / rag / worker / db / qdrant / ollama 全部 Up
