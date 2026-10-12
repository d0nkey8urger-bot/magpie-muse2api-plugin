# 显示托管 muse2api 实例的接入信息:地址、key、模型,
# 给 magpie 手填的字段,和 cc-switch 的一键导入链接。
# 任何时候想再看一眼,运行: powershell -ExecutionPolicy Bypass -File show-connection.ps1
$managedHome = $env:MUSE2API_PLUGIN_HOME
if (-not $managedHome) { $managedHome = Join-Path $env:USERPROFILE ".muse2api-plugin" }
$envFile = Join-Path $managedHome ".env"
if (-not (Test-Path $envFile)) {
  Write-Host "没有找到托管安装 ($envFile)。"
  Write-Host "先双击一键安装.bat 完成一次管家安装，这里才有信息可显示。"
  exit 1
}
$key = $null
foreach ($line in Get-Content $envFile) {
  if ($line -match '^MUSE2API_KEY=(\S+)$') { $key = $Matches[1] }
}
if (-not $key) { Write-Host ".env 里没有 MUSE2API_KEY，安装可能没完成。"; exit 1 }
$base = "http://127.0.0.1:18610/v1"
function Enc($s) { [uri]::EscapeDataString($s) }
$name = Enc "Muse (muse2api)"
$hp = Enc "https://muse.ai"
$ep = Enc $base
$k = Enc $key
$notes = Enc "Muse (muse.ai) through a local muse2api instance"
$ccCodex = "ccswitch://v1/import?resource=provider&app=codex&name=$name&homepage=$hp&endpoint=$ep&apiKey=$k&model=muse-spark&enabled=true&notes=$notes"
$ccOpencode = "ccswitch://v1/import?resource=provider&app=opencode&name=$name&homepage=$hp&endpoint=$ep&apiKey=$k&model=muse-spark&enabled=true&notes=$notes"
Write-Host ""
Write-Host "========== muse2api 接入信息 =========="
Write-Host "API 地址: $base"
Write-Host "API Key : $key"
Write-Host "模型    : muse-spark"
Write-Host ""
Write-Host "-- 已经在用 magpie:在 magpie 里新建自定义供应商,四项照上面填 --"
Write-Host "   供应商名 muse2api / 地址 / key / 模型 muse-spark"
Write-Host ""
Write-Host "-- 已经在用 cc-switch:把对应链接粘到浏览器打开,即刻导入 --"
Write-Host "Codex   : $ccCodex"
Write-Host "OpenCode: $ccOpencode"
Write-Host "========================================="
