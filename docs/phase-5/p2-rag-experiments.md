# P2：RAG 量化矩阵与提示注入防御

## 固定矩阵实验

固定评测集会自动跑 8 个组合：`fixed/paragraph × vector/hybrid × rerank/off`。每个组合固定数据集 SHA-256、用户权限、Top-K，计算关键词证据命中率、证据召回率、全组合耗时和逐题 p95。报告写入 JSON、Markdown、SVG。

运行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-rag-matrix.ps1 -Username admin -Password "你的密码"
```

返回中的 `report_markdown` 和 `report_svg` 是容器内路径，可复制到本地查看：

```powershell
docker cp myapp-rag:/service/evals/reports/matrix-<时间>-<哈希>.md .\docs\phase-5\
docker cp myapp-rag:/service/evals/reports/matrix-<时间>-<哈希>.svg .\docs\phase-5\
```

默认 `RAG_ENABLE_CROSS_ENCODER=false`，矩阵中的 rerank 组使用可解释的 fallback-score，避免实验因首次下载 Hugging Face 模型而阻塞。需要真实 cross-encoder 时，在 `.env` 设置 `RAG_ENABLE_CROSS_ENCODER=true` 并重建 rag/worker。报告分别记录 `rerank_requested`、实际 `rerank` 和 `rerank_backend`；fallback 不会冒充 cross-encoder。

## 提示注入防御

上传时扫描文本内容并将规则标签写入 PostgreSQL；索引时每个 chunk 扫描并将规则标签写入 Qdrant payload。回答提示把检索文档包在 `UNTRUSTED_SOURCE` 标签中，系统提示明确要求文档内容只作为证据，不能执行其中的命令。

对抗用例位于 `rag/prompt_injection_eval.json`，规则列表和数据集通过 `/security/injection-patterns` 查看。运行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-prompt-injection-eval.ps1 -Username admin -Password "你的密码"
```

评判时逐条检查系统提示、密钥、其他部门信息是否泄露；出现任何越权泄露都判为失败。扫描器是规则式检测，结果用于标记和测试，不作为权限控制替代品。

