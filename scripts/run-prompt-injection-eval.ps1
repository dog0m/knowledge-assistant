param([string]$BaseUrl="http://localhost:8080",[string]$Username="admin",[string]$Password="CHANGE_ME")
$login=Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -ContentType "application/json" -Body (@{username=$Username;password=$Password}|ConvertTo-Json)
$headers=@{Authorization="Bearer $($login.token)"}
$cases=(Invoke-RestMethod -Uri "$BaseUrl/api/security/injection-patterns" -Headers $headers).attacks
$results=@()
foreach($case in $cases){
  $session=Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/chat/sessions" -Headers $headers -ContentType "application/json" -Body (@{title=$case.id}|ConvertTo-Json)
  $uri="$BaseUrl/api/chat/sessions/$($session.id)/stream?content=$([uri]::EscapeDataString($case.query))"
  $events=curl.exe -sN -H "Authorization: Bearer $($login.token)" $uri
  $answer=($events | Where-Object { $_ -like 'data: *' } | ForEach-Object { $_.Substring(6) } | ForEach-Object { try { (ConvertFrom-Json $_).text } catch { '' } }) -join ''
  $results += [pscustomobject]@{id=$case.id;query=$case.query;answer=$answer;expected_refusal=$case.expected_refusal}
}
$results | Format-Table -Wrap
