# 阶段 4：管理界面与多轮体验

## 已实现能力

- 登录、退出和当前用户信息；密码使用 Node.js `scrypt` 哈希，数据库只保存 session 令牌的哈希。
- 知识库创建、查看和成员维护。成员变更会同步到关联文档的 PostgreSQL ACL 和 Qdrant payload。
- 文档批量上传、状态查看、失败重试、删除和 CSV 导出。上传时可以选择知识库；未选择知识库时按部门授权。
- 会话消息持久化、最近 12 条历史对话、多轮回答和引用展开。
- 回答评分/评论与 `trace_id` 关联，管理员可查看汇总并导出反馈 CSV。
- 管理员创建用户；维护员只能查看本部门用户，不能创建账号或修改其他部门的知识库。
- RAG 服务不再映射到宿主机端口，只允许 Docker 网络内的业务 API 调用，避免客户端绕过登录伪造角色。

## 启动

在项目目录运行：

```powershell
docker compose up -d --build app rag
docker compose ps
docker compose logs --tail 100 app rag
```

数据库表由应用启动时自动创建，不需要重启或清空 PostgreSQL。Compose 重建 `app` 和 `rag` 即可应用代码和端口映射变化。

首次登录使用 `.env` 中配置的管理员账号。将 `ADMIN_INITIAL_PASSWORD` 改为至少 10 位强密码后再用于非本机环境；已存在的管理员不会因修改该环境变量而自动改密。

## 手工验收

1. 管理员登录后，在“用户管理”创建两个普通用户，分别设置不同部门；核对用户列表和登录状态。
2. 在“知识库”创建知识库并添加一个用户；另一个用户不能看到这个库。
3. 将 Markdown/TXT 样本上传到该知识库。成员可在文档列表中看到并检索；非成员不能看到文档，也不能从聊天引用中读到它。
4. 上传失败文件后检查状态、错误信息和重试操作；删除文档后再次提问，旧内容应不再出现。
5. 创建会话并连续提问第二个依赖首轮上下文的问题；确认回答具有上下文并能展开引用。
6. 为回答提交评分和评论，记录页面显示的 `trace_id`；管理员导出反馈 CSV 并确认对应记录存在。
7. 管理员/维护员导出文档 CSV；用普通用户请求 `/api/admin/stats` 应返回 `403`。
8. 检查 `docker compose ps`：`app` 映射到宿主机，`rag` 仅显示容器内部的 `8090/tcp`，不应有宿主机端口映射。

## 常用请求示例

登录后可在 PowerShell 中保存令牌并访问受保护接口：

```powershell
$login = Invoke-RestMethod -Method Post -Uri "http://localhost:8080/api/auth/login" `
  -ContentType "application/json" `
  -Body (@{ username = "admin"; password = "替换为你的管理员密码" } | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod -Uri "http://localhost:8080/api/knowledge-bases" -Headers $headers
Invoke-RestMethod -Uri "http://localhost:8080/api/admin/stats" -Headers $headers
```
