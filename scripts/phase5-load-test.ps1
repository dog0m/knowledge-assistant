param(
  [int]$Requests = 30,
  [int]$Concurrency = 5,
  [string]$BaseUrl = "http://localhost:8080",
  [string]$Username = "admin",
  [string]$Password = "change-me-now"
)

# 阶段 5 并发采样：测试已登录的轻量接口，避免并发压测重复调用模型产生不可控费用。
# 记录 p50/p95 和错误数；真正的模型吞吐测试另行用固定评测集运行。
$ErrorActionPreference = "Stop"
$loginBody = @{ username = $Username; password = $Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -ContentType "application/json" -Body $loginBody
$headers = @{ Authorization = "Bearer $($login.token)" }

$jobs = @()
$started = Get-Date
for ($i = 0; $i -lt $Requests; $i++) {
  while (($jobs | Where-Object State -eq "Running").Count -ge $Concurrency) { Start-Sleep -Milliseconds 20 }
  $jobs += Start-Job -ArgumentList $BaseUrl,$headers -ScriptBlock {
    param($url,$requestHeaders)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
      Invoke-RestMethod -Method Get -Uri "$url/health" -Headers $requestHeaders | Out-Null
      $timer.Stop(); [pscustomobject]@{ ok = $true; ms = $timer.Elapsed.TotalMilliseconds }
    } catch {
      $timer.Stop(); [pscustomobject]@{ ok = $false; ms = $timer.Elapsed.TotalMilliseconds; error = $_.Exception.Message }
    }
  }
}
$results = $jobs | ForEach-Object { Receive-Job $_ -Wait -AutoRemoveJob }
$durations = @($results | Where-Object ok | ForEach-Object ms | Sort-Object)
if ($durations.Count -eq 0) { throw "没有成功请求" }
$p50 = $durations[[Math]::Min($durations.Count - 1, [Math]::Floor($durations.Count * 0.50))]
$p95 = $durations[[Math]::Min($durations.Count - 1, [Math]::Floor($durations.Count * 0.95))]
$errors = @($results | Where-Object { -not $_.ok }).Count
$elapsed = ((Get-Date) - $started).TotalSeconds
Write-Output ("requests={0} concurrency={1} errors={2} p50_ms={3:N1} p95_ms={4:N1} elapsed_s={5:N1}" -f $Requests,$Concurrency,$errors,$p50,$p95,$elapsed)
if ($errors -gt [Math]::Max(1, [Math]::Floor($Requests * 0.01))) { throw "错误率超过 1%" }
