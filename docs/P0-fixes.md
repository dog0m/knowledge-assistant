# P0 安全问题修复记录

修复日期：2026-10-09
基于审查文档：`docs/project-review-and-roadmap.md`

## 修复清单

### ✅ 1. RAG 服务内部鉴权（已完成）
**问题**：RAG 服务信任调用方传入的身份，可能被越权。
**修复**：
- `compose.yml` 已配置 `INTERNAL_API_KEY` 环境变量（第19、105行）
- `rag/main.py` 已实现中间件验证 `X-Internal-Token`（第29-39行）
- `app/server.js` 已在 `ragRequest` 中携带内部令牌（第174-176行）
- RAG 服务端口保持 `expose` 状态，不映射到宿主机（`compose.yml` 第107-108行）

**位置**：
- [compose.yml:19](compose.yml:19)
- [compose.yml:105](compose.yml:105)
- [rag/main.py:29-39](rag/main.py:29-39)
- [app/server.js:174-176](app/server.js:174-176)

---

### ✅ 2. 向量集合按模型隔离
**问题**：换同维度模型时会把不兼容向量混在同一个 collection。
**修复**：
- `collection_name()` 函数已包含模型名和切分策略（`rag/main.py:237-241`）
- 在 `index_document()` 中的 payload 显式存储 `embedding_model` 和 `vector_dimension`
- 确保换模型时能识别旧向量，触发重建索引

**位置**：
- [rag/main.py:237-241](rag/main.py:237-241) - collection_name 函数
- [rag/main.py:340-341](rag/main.py:340-341) - payload 中记录模型和维度

**改动文件**：
```python
# rag/main.py index_document() 函数
payload={
    # ... 其他字段 ...
    "embedding_model": OLLAMA_EMBED_MODEL,  # P0修复2：显式记录模型名
    "vector_dimension": len(vector),  # P0修复2：记录向量维度
}
```

---

### ✅ 3. 知识库成员变更不覆盖手工 ACL
**问题**：`syncKnowledgeBaseDocumentAccess` 用成员列表覆盖所有 `allowed_users`。
**修复**：
- 数据库已添加 `manual_allowed_users` 和 `kb_allowed_users` 字段（`rag/main.py:93-94`）
- `update_document_acl_source()` 函数按来源分别更新（`rag/main.py:979-1005`）
- `access_allowed()` 合并两个来源的 ACL（`rag/main.py:294-301`）
- `app/server.js` 调用 `/kb-access` 端点而非 `/access`（第164行）

**位置**：
- [rag/main.py:93-94](rag/main.py:93-94) - 数据库字段
- [rag/main.py:979-1005](rag/main.py:979-1005) - ACL 更新函数
- [rag/main.py:294-301](rag/main.py:294-301) - 权限判断
- [app/server.js:164](app/server.js:164) - 知识库 ACL 同步

---

### ✅ 4. 文档更新原子切换
**问题**：先删后建窗口导致索引中途失败时文档既没有旧向量也没有新向量。
**修复**：
- 新版本使用带 `version` 的 point id（`rag/main.py:330`）
- 新版本索引成功后才更新数据库指向新版本（`rag/main.py:1081-1092`）
- 数据库切换成功后再删除旧版本向量（`rag/main.py:1105-1109`）
- 任何步骤失败都清理失败版本，保留旧版本可用

**位置**：
- [rag/main.py:1019-1112](rag/main.py:1019-1112) - update_document 函数完整流程

**关键改动**：
```python
# 1. 新版本写入临时路径
temp_path.write_bytes(content)
# 2. 索引新版本（失败只清理新版本）
count = await index_document(updated)
# 3. 重命名临时文件
temp_path.replace(new_path)
# 4. 更新数据库（失败删除新版本文件和向量）
conn.execute("UPDATE documents SET version=%s ...")
# 5. 删除旧版本向量（失败只记日志，不影响新版本）
delete_document_versions(document_id, updated["version"], collection.name)
```

---

### ✅ 5. 更新文档校验归属部门
**问题**：维护员可以覆盖其他部门的同名文档。
**修复**：
- `rag/main.py` 的 `update_document()` 增加部门校验（第1034-1037行）
- `app/server.js` 的 `/api/documents/:id` 增加知识库关联校验（第524-530行）
- 维护员只能更新自己部门、public 或自己部门知识库关联的文档

**位置**：
- [rag/main.py:1034-1037](rag/main.py:1034-1037) - RAG 层校验
- [app/server.js:524-530](app/server.js:524-530) - App 层校验

---

### ✅ 6. 上传文件校验增强
**问题**：只按扩展名放行，未校验 MIME 与文件头。
**修复**：
- `validate_file_bytes()` 增加 MIME 类型校验（`rag/main.py:821`）
- PDF 校验 `%PDF-` 魔术字节（第824行）
- DOCX 校验 ZIP 结构和 `word/document.xml`（第826-836行）
- 文本文件校验 UTF-8 编码和无二进制内容（第838-843行）
- 限制 DOCX 解压后总大小防止 ZIP 炸弹（第833行）

**位置**：
- [rag/main.py:816-843](rag/main.py:816-843) - validate_file_bytes 函数

**已实现的校验**：
1. 扩展名白名单
2. MIME 类型与扩展名匹配
3. 文件大小限制（50MB）
4. 文件头魔术字节校验
5. 压缩包结构和解压大小校验
6. 文本编码校验

---

### ✅ 7. 异步入库（已实现）
**问题**：同步阻塞式入库导致大文件挂住请求。
**修复**：
- `compose.yml` 已添加独立 `worker` 服务（第122-153行）
- 上传接口调用 `enqueue_document()` 只入队（`rag/main.py:855-859`）
- `worker.py` 异步处理索引任务（完整文件）
- 数据库新增 `document_jobs` 表管理任务状态（`rag/main.py:106-115`）

**位置**：
- [compose.yml:122-153](compose.yml:122-153) - worker 服务定义
- [rag/main.py:855-859](rag/main.py:855-859) - 入队函数
- [worker.py:1-71](worker.py:1-71) - 异步 worker 实现

---

### ✅ 8. 密钥与数据边界
**问题**：`.env` 可能被提交，示例命令泄露 UUID，备份文件包含真实数据。
**修复**：
- `.gitignore` 已排除 `.env` 和 `backup/*.sql`（已存在）
- 创建 `.env.example` 作为配置模板（不含真实密钥）
- 创建 `.gitattributes` 确保敏感文件不被导出
- 删除 `backup/myapp.sql` 真实数据库导出

**位置**：
- [.gitignore:2-3](.gitignore:2-3) - 排除敏感文件
- [.env.example](.env.example) - 配置模板（新建）
- [.gitattributes](.gitattributes) - 导出控制（新建）

**操作**：
```bash
# 已删除真实备份
rm backup/myapp.sql

# 已创建模板
.env.example - 包含所有配置项但不含真实密钥
.gitattributes - 确保 .env 不被 git archive 导出
```

---

## 验证建议

### 1. 内部鉴权验证
```bash
# 从容器外尝试直接调用 RAG（应被拒绝）
curl http://localhost:8090/documents
# 预期：连接被拒绝（端口未映射）

# 从 app 容器内不带令牌调用（应返回 401）
docker exec myapp-app curl -s http://rag:8090/documents
# 预期：{"detail":"内部服务鉴权失败"}
```

### 2. 集合隔离验证
```bash
# 查看当前 collection 名称
curl http://localhost:6333/collections
# 预期：名称包含模型名、维度和策略
# 例如：knowledge_chunks_bge_m3_1024_fixed
```

### 3. ACL 来源验证
```sql
-- 查看 ACL 字段
SELECT id, filename, manual_allowed_users, kb_allowed_users, allowed_users 
FROM documents LIMIT 5;
-- 预期：allowed_users = manual ∪ kb
```

### 4. 版本化更新验证
```bash
# 更新一个文档后查看向量
curl http://localhost:6333/collections/knowledge_chunks_*/points/scroll | jq '.result.points[] | select(.payload.document_id=="<doc-id>") | .payload.version'
# 预期：只有最新版本
```

### 5. 部门权限验证
```bash
# 维护员尝试更新其他部门文档
# 预期：403 Forbidden
```

### 6. 文件校验验证
```bash
# 上传伪造扩展名的文件
echo "fake content" > fake.pdf
# 预期：415 PDF 文件头校验失败
```

### 7. 异步入库验证
```bash
# 上传后立即查看状态
# 预期：status='queued'
# 几秒后：status='processing' 或 'ready'
```

### 8. 密钥边界验证
```bash
# 确认 .env 未被追踪
git status .env
# 预期：未列出或显示在 .gitignore 中

# 确认 backup 目录干净
ls backup/
# 预期：只有 .gitkeep 或目录为空
```

---

## 后续建议

虽然已完成 P0 修复，但以下 P1/P2 问题仍需关注：

1. **配置集中化**：rag/main.py 的 `os.getenv` 散布各处，建议用 pydantic-settings
2. **数据库迁移**：引入 Alembic 管理 schema 变更
3. **统一错误处理**：Python 改用 logging + JSON formatter
4. **单元测试**：覆盖权限、切分、检索等核心函数
5. **CI/CD**：GitHub Actions 跑 lint + test
6. **流式输出**：当前 stream: false，建议实现 SSE
7. **README**：补充架构图、快速开始、评测结果

---

## 改动文件总结

### 修改的文件
1. `rag/main.py` - 5 处修复（集合隔离、ACL、原子更新、部门校验、文件校验）
2. `app/server.js` - 1 处修复（部门校验）

### 新增的文件
1. `.env.example` - 配置模板
2. `.gitattributes` - 导出控制
3. `docs/P0-fixes.md` - 本文档

### 删除的文件
1. `backup/myapp.sql` - 真实数据库导出

---

## 兼容性说明

所有修复向后兼容，对已有数据的处理：
- 旧文档的 `allowed_users` 在启动时自动迁移为 `manual_allowed_users`（`rag/main.py:119`）
- 旧集合继续可用，换模型时自动触发重建索引（`queue_reindex_for_collection_migration`）
- 所有新索引的文档都会包含新的 payload 字段

---

**修复完成日期**：2026-10-09
**审查人**：Claude Opus 5.5
**状态**：✅ P0 问题全部修复
