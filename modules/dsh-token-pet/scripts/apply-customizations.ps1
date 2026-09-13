# 把本定制层补丁应用到上游克隆上（Windows / PowerShell 7+）
#
# 用法:
#   pwsh scripts/apply-customizations.ps1 -Target <上游克隆目录>
#   pwsh scripts/apply-customizations.ps1 -Target . -Check      # 只检查能否干净应用
#
# 说明:
#   - 补丁相对基线 commit cc49233（v0.2.0），见 patches/UPSTREAM-BASE.txt
#   - 上游升级后重新应用；若报冲突，按补丁意图手工合并
param(
    [Parameter(Mandatory = $true)][string]$Target,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$patch = Join-Path $PSScriptRoot '..\patches\0001-lina-customizations.patch'
$patch = (Resolve-Path $patch).Path
$target = (Resolve-Path $Target).Path

if (-not (Test-Path (Join-Path $target '.git'))) {
    throw "目标目录不是 git 仓库: $target"
}

Write-Host "补丁  : $patch"
Write-Host "目标  : $target"

git -C $target apply --check $patch
if ($LASTEXITCODE -ne 0) {
    throw "补丁无法干净应用（可能上游已变更）。请检查基线或手工合并。"
}
Write-Host "✓ 预检通过" -ForegroundColor Green

if ($Check) {
    Write-Host "仅检查模式，未实际应用。" -ForegroundColor Yellow
    exit 0
}

git -C $target apply $patch
if ($LASTEXITCODE -ne 0) { throw "应用失败" }
Write-Host "✓ 定制补丁已应用。接下来: npm install && npm run build" -ForegroundColor Green
Write-Host "  挂载: dsh plugin --profile desktop add link:$target"
