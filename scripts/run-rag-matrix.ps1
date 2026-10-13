param(
  [string]$BaseUrl = "http://localhost:8080",
  [string]$Username = "admin",
  [string]$Password = "CHANGE_ME",
  [string]$Department = "platform"
)

# 固定运行八组 RAG 参数矩阵；结果文件由 API 保存到容器 reports 目录。
$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -ContentType "application/json" -Body (@{username=$Username;password=$Password}|ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($login.token)" }
$body = @{user_id=$login.user.id;department=$Department;role=$login.user.role;top_k=5}|ConvertTo-Json
$result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/evaluation/matrix" -Headers $headers -ContentType "application/json" -Body $body
$result | ConvertTo-Json -Depth 10
Write-Output "报告 JSON/Markdown/SVG 路径由 report_json、report_markdown、report_svg 返回。"
