<#
  mermaid 运行时 安装 / 迁移（dsh-doc-suite · 文档模块 · B 线施工 ⑥）

  为什么单独一个脚本：Node 依赖**不进 dependencies / files** ——
  puppeteer 的 postinstall 可能下载 Chromium，网络失败会连累整个插件装不上。

  用法（默认只打印现状与将执行的命令，不动系统）：
    powershell -ExecutionPolicy Bypass -File setup_mermaid.ps1                 # 体检：Node / npm / Edge / 运行时
    powershell -ExecutionPolicy Bypass -File setup_mermaid.ps1 -Install        # 在标准位置安装（不下载 Chromium）
    powershell -ExecutionPolicy Bypass -File setup_mermaid.ps1 -MoveFrom <dir> # 把已有运行时迁到标准位置

  标准位置：~/.dsh/data/dsh-doc-suite/tools/mermaid/
#>
param(
  [switch]$Install,
  [string]$MoveFrom = '',
  [string]$ToolsDir = "$env:USERPROFILE\.dsh\data\dsh-doc-suite\tools\mermaid"
)

$ErrorActionPreference = 'Stop'
$edgeCandidates = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
)
$edge = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

function Show-Status {
  Write-Output "== mermaid 运行时体检 =="
  $node = (Get-Command node -ErrorAction SilentlyContinue)
  $npm = (Get-Command npm -ErrorAction SilentlyContinue)
  Write-Output ("node      : " + $(if ($node) { (& node --version) } else { '未找到（需 Node >= 18）' }))
  Write-Output ("npm       : " + $(if ($npm) { (& npm --version) } else { '未找到' }))
  Write-Output ("Edge      : " + $(if ($edge) { $edge + '  v' + (Get-Item $edge).VersionInfo.ProductVersion } else { '未找到（不下载 Chromium 时必须用本机 Edge）' }))
  Write-Output ("标准位置  : " + $ToolsDir)
  $cli = Join-Path $ToolsDir 'node_modules\@mermaid-js\mermaid-cli\src\cli.js'
  Write-Output ("运行时    : " + $(if (Test-Path $cli) { '已就位' } else { '未安装' }))
}

Show-Status

if ($MoveFrom -ne '') {
  if (-not (Test-Path (Join-Path $MoveFrom 'node_modules'))) { throw "源目录里没有 node_modules：$MoveFrom" }
  if (Test-Path $ToolsDir) {
    $hasCli = Test-Path (Join-Path $ToolsDir 'node_modules\@mermaid-js\mermaid-cli\src\cli.js')
    if ($hasCli) { Write-Output "标准位置已有运行时，未做迁移。"; exit 0 }
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $ToolsDir) | Out-Null
  Write-Output ("迁移：$MoveFrom  ->  $ToolsDir")
  Move-Item -LiteralPath $MoveFrom -Destination $ToolsDir
  Write-Output "迁移完成。"
  Show-Status
  exit 0
}

if ($Install) {
  if (-not $edge) { throw "未找到本机 Edge：不下载 Chromium 的安装方式需要 Edge，请先安装 Edge。" }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "未找到 npm（需 Node >= 18）。" }
  New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
  Set-Location $ToolsDir
  $pkgPath = Join-Path $ToolsDir 'package.json'
  if (-not (Test-Path $pkgPath)) {
    $pkgJson = '{"name":"dsh-doc-suite-mermaid","private":true,"description":"mermaid runtime (not shipped; installed by setup_mermaid.ps1)","dependencies":{"@mermaid-js/mermaid-cli":"11.17.0","puppeteer":"25.11.0"}}'
    [System.IO.File]::WriteAllText($pkgPath, $pkgJson, (New-Object System.Text.UTF8Encoding($false)))
  }
  $cfg = '{"executablePath":"' + ($edge -replace '\\', '/') + '"}'
  [System.IO.File]::WriteAllText((Join-Path $ToolsDir 'puppeteer.json'), $cfg, (New-Object System.Text.UTF8Encoding($false)))
  $env:PUPPETEER_SKIP_DOWNLOAD = '1'
  Write-Output "执行：npm install（PUPPETEER_SKIP_DOWNLOAD=1，不下载 Chromium）"
  & npm install --no-audit --no-fund
  Write-Output "安装完成。"
  Show-Status
  exit 0
}

Write-Output ""
Write-Output "以上仅为体检。要安装或迁移，请加参数："
Write-Output "  -Install                # 在标准位置安装（不下载 Chromium，用本机 Edge）"
Write-Output "  -MoveFrom 目录路径        # 把别处的运行时迁到标准位置"
