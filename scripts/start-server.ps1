# FramePilot 本机后端启动脚本（使用 .venv-yolo，含 Ultralytics + CUDA torch）
# 用法：在项目根目录执行  .\scripts\start-server.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Py = Join-Path $Root ".venv-yolo\Scripts\python.exe"
if (-not (Test-Path $Py)) {
  Write-Error "未找到 $Py 。请先用 py -3.12 创建 .venv-yolo 并安装依赖（见 docs/ai-setup.md）。"
}
Write-Host "使用解释器: $Py"
Write-Host "工作目录: $Root"
Write-Host "监听: http://127.0.0.1:18000"
& $Py -m uvicorn server.main:app --host 127.0.0.1 --port 18000
