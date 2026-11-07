# Creates the Hugging Face Space (if it doesn't exist) and pushes this demo to it.
#   powershell -ExecutionPolicy Bypass -File .\spaces\qwen3-4b-demo\push.ps1
# It asks for a Hugging Face access token (Write permission) with the typing
# hidden, uses it for this run only, and never saves it anywhere.

$user = 'Deemug'
$name = 'qwen3-4b-demo'
$space = "https://huggingface.co/spaces/$user/$name"

$secure = Read-Host 'Paste your Hugging Face token (typing is hidden), then press Enter' -AsSecureString
$token = [System.Net.NetworkCredential]::new('', $secure).Password
if (-not $token) { Write-Host 'No token entered.'; exit 1 }
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${user}:${token}"))
$auth = "http.extraHeader=Authorization: Basic $basic"

# Create the public Space; a 409 means it already exists, which is fine.
try {
    $body = @{ type = 'space'; name = $name; sdk = 'gradio'; private = $false } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri 'https://huggingface.co/api/repos/create' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body | Out-Null
    Write-Host "Created $space"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -ne 409) { Write-Host "Could not create the Space (HTTP $code). Check the token has Write permission."; exit 1 }
    Write-Host 'The Space already exists; updating it.'
}

$work = Join-Path ([IO.Path]::GetTempPath()) "hf-$name"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
git -c $auth clone $space $work
if ($LASTEXITCODE -ne 0) { Write-Host 'Could not clone the Space.'; exit 1 }

Get-ChildItem $PSScriptRoot -File | Where-Object { $_.Name -ne 'push.ps1' } | Copy-Item -Destination $work -Force

git -C $work checkout -B main
git -C $work config user.email '274588930+dmotionstudio-stack@users.noreply.github.com'
git -C $work config user.name 'Scorpion'
git -C $work add -A
git -C $work commit -m 'Qwen3 4B chat demo'
git -C $work -c $auth push origin HEAD:main
if ($LASTEXITCODE -ne 0) { Write-Host 'The push failed.'; exit 1 }

Write-Host ''
Write-Host 'Pushed. Hugging Face is building the Space (several minutes, then it downloads the model):'
Write-Host $space
