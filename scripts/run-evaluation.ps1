param(
  [string]$BaseUrl = "http://localhost:8080",
  [string]$Username = "admin",
  [string]$Password = "CHANGE_ME"
)

# 运行固定评测集并保存报告路径；用于本地和 CI 冒烟。
$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -ContentType "application/json" -Body (@{username=$Username;password=$Password}|ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($login.token)" }
$body = @{user_id=$login.user.id;department=$login.user.department;role=$login.user.role;modes=@("vector","hybrid")} | ConvertTo-Json
$result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/evaluation/run" -Headers $headers -ContentType "application/json" -Body $body
$result.summary | ConvertTo-Json -Depth 6
Write-Output "report_path=$($result.report_path)"
