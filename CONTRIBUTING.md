# Contributing

感谢参与。提交前请先阅读以下约定。

## 环境准备

```powershell
Copy-Item .env.example .env
# 填写数据库密码、管理员密码、INTERNAL_API_KEY
docker compose up -d --build app rag worker
```

## 提交前检查

```powershell
node --check app/server.js
node --check app/public/app.js
python -m py_compile rag/main.py rag/settings.py rag/security.py rag/worker.py
docker compose config --quiet
python -m pytest -q
ruff check rag
```

## 代码约定

- Python 使用 4 空格缩进，函数写中文注释说明意图。
- JavaScript 保持现有风格，新增逻辑必须带注释。
- 新增接口需说明权限要求、请求参数和错误码。
- 改动检索或切分策略时，必须重新运行 `POST /api/evaluation/matrix` 并更新报告。

## 禁止提交

- `.env`、任何 API Key、密码、令牌
- 真实企业文档、数据库导出、备份文件
- 与本项目无关的本地工具链目录

## Pull Request

- 描述问题、改动、验证方式
- 附带测试结果或评测报告
- 保持单个 PR 聚焦一个主题
