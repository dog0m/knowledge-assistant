# 阶段 0 试点数据

## 试点部门选择

建议将 **技术支持/平台运维部** 作为模拟试点部门。这里使用公开的技术项目文档模拟低敏内部知识库，适合验证文档解析、检索、引用、版本更新和无法回答场景。

这批资料不代表真实企业制度，不能用于验证真实组织权限。真实业务数据接入前，仍需让业务负责人确认文档敏感级别、权限来源和脱敏结果。

## 已下载文件

| 文件 | 来源 | 许可证/授权说明 | 用途 |
|---|---|---|---|
| `technical-support/docker-what-is-a-container.md` | [Docker Docs](https://github.com/docker/docs/blob/main/content/get-started/docker-concepts/the-basics/what-is-a-container.md) | Docker 文档采用 CC BY 4.0，代码示例按项目说明使用 | 容器概念问答 |
| `technical-support/docker-what-is-an-image.md` | [Docker Docs](https://github.com/docker/docs/blob/main/content/get-started/docker-concepts/the-basics/what-is-an-image.md) | CC BY 4.0 | 镜像概念问答 |
| `technical-support/docker-what-is-a-registry.md` | [Docker Docs](https://github.com/docker/docs/blob/main/content/get-started/docker-concepts/the-basics/what-is-a-registry.md) | CC BY 4.0 | 镜像仓库问答 |
| `technical-support/fastapi-first-steps.md` | [FastAPI](https://github.com/fastapi/fastapi/blob/master/docs/en/docs/tutorial/first-steps.md) | FastAPI 项目 MIT；文档内容以仓库声明为准 | API 入门问答 |
| `technical-support/fastapi-request-body.md` | [FastAPI](https://github.com/fastapi/fastapi/blob/master/docs/en/docs/tutorial/body.md) | FastAPI 项目 MIT；文档内容以仓库声明为准 | 请求体和校验问答 |
| `technical-support/pgvector-readme.md` | [pgvector](https://github.com/pgvector/pgvector/blob/master/README.md) | PostgreSQL License | 向量检索和索引问答 |
| `technical-support/qdrant-readme.md` | [Qdrant](https://github.com/qdrant/qdrant/blob/master/README.md) | Apache 2.0 | 向量数据库问答 |
| `technical-support/ollama-readme.md` | [Ollama](https://github.com/ollama/ollama/blob/main/README.md) | MIT | 本地模型服务问答 |

## 建议先做的测试

1. 将这些 Markdown 文件导入一个知识库，保留文件名、来源 URL、下载时间和许可证字段。
2. 先建立 30 道问题：事实查找、配置步骤、概念比较、跨文档总结和无法回答各占一部分。
3. 修改其中一个本地副本，验证文档版本更新后旧内容不再被召回。
4. 加入一个权限标签，例如 `department=platform`，验证无标签用户不能检索。

## 来源记录

- 下载日期：2026-09-29
- 下载方式：GitHub raw 文件
- 数据性质：公开开源项目文档，用于开发和评测，不含本企业数据
- 校验：文件均为 Markdown 文本，适合直接进行首轮解析和切分

