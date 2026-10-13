# 阶段 1：本地可运行骨架

## 已实现

- Node 22 + Express API 骨架。
- PostgreSQL 持久化和健康检查。
- Qdrant 服务、健康检查和持久化卷。
- Ollama 服务、GPU 支持和模型持久化卷。
- 模型提供商可通过 `MODEL_PROVIDER` 切换：`ollama` 或 `openai`。
- OpenAI 配置接口同时兼容 OpenAI 官方 API 和其他 OpenAI-compatible 服务。

## 启动

```powershell
docker compose up -d --build
docker compose ps
```

首次使用 Ollama 时下载模型：

```powershell
docker exec myapp-ollama ollama pull llama3.2:3b
```

## API 验证

```powershell
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod http://localhost:8080/api/model/config
Invoke-RestMethod http://localhost:8080/api/model/health
Invoke-RestMethod http://localhost:8080/api/chat -Method Post -ContentType 'application/json' -Body '{"message":"What is a Docker container?"}'
```

## 切换到 OpenAI

在 `.env` 中设置：

```dotenv
MODEL_PROVIDER=openai
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_KEY=your-key
```

然后重建应用容器：

```powershell
docker compose up -d --build app
```

API 不会通过 `/api/model/config` 返回密钥。密钥只注入应用容器环境变量，并且不应提交到版本库。

