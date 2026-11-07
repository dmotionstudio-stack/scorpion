# Pushes the website to its Hugging Face Space. Run it in PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\website\hf-space\push.ps1
#   powershell -ExecutionPolicy Bypass -File .\website\hf-space\push.ps1 -Name dms
# It asks for a Hugging Face access token (Write permission) with the typing
# hidden, uses it for this push only, and never saves it anywhere.
# Everything already in the Space is replaced by the site.

#   ... -Name scorp -Static     pages only (a static Space: no server, no hardware)

param([string]$Name = 'scorp', [switch]$Static)

$user = 'Deemug'
$space = "https://huggingface.co/spaces/$user/$Name"
$site = Split-Path -Parent $PSScriptRoot

$secure = Read-Host 'Paste your Hugging Face token (typing is hidden), then press Enter' -AsSecureString
$token = [System.Net.NetworkCredential]::new('', $secure).Password
if (-not $token) { Write-Host 'No token entered.'; exit 1 }
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${user}:${token}"))
$auth = "http.extraHeader=Authorization: Basic $basic"

$work = Join-Path ([IO.Path]::GetTempPath()) "hf-site-$Name"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }

git -c $auth clone $space $work
if ($LASTEXITCODE -ne 0) { Write-Host 'Could not clone the Space. Check the token has Write permission and the Space address is right.'; exit 1 }

# Clear whatever the Space held (a starter template, an older site), then copy
# the site in: not secrets, not this folder, not node_modules.
Get-ChildItem $work -Force | Where-Object { $_.Name -notin '.git', '.gitattributes' } | Remove-Item -Recurse -Force
$skipDirs = @('node_modules', 'hf-space', '.git')
$skipFiles = @('.env')
$readme = 'README.md'
if ($Static) {
    # A static Space only serves files, so leave the server code behind.
    $skipDirs += @('api', 'lib')
    $skipFiles += @('dev-server.mjs', 'Dockerfile', '.dockerignore', 'package.json', '.env.example', 'README.md')
    $readme = 'README.static.md'
}
robocopy $site $work /E /XD $skipDirs /XF $skipFiles /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $PSScriptRoot $readme) (Join-Path $work 'README.md') -Force

git -C $work checkout -B main
git -C $work config user.email '274588930+dmotionstudio-stack@users.noreply.github.com'
git -C $work config user.name 'Scorpion'
git -C $work add -A
git -C $work commit -m 'Scorpion website'
git -C $work -c $auth push origin HEAD:main
if ($LASTEXITCODE -ne 0) { Write-Host 'The push failed.'; exit 1 }

Write-Host ''
Write-Host 'Pushed. Hugging Face is building the site now (a few minutes):'
Write-Host $space
Write-Host "Live address: https://$($user.ToLower())-$($Name.ToLower()).hf.space"
