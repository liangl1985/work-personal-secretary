#!/usr/bin/env bash
# 把本定制层补丁应用到上游克隆上（Linux / macOS / WSL）
#
# 用法:
#   bash scripts/apply-customizations.sh <上游克隆目录> [--check]
#
# 补丁相对基线 commit cc49233（v0.2.0），见 patches/UPSTREAM-BASE.txt。
set -euo pipefail

TARGET="${1:?用法: apply-customizations.sh <上游克隆目录> [--check]}"
MODE="${2:-apply}"
PATCH="$(cd "$(dirname "$0")/.." && pwd)/patches/0001-lina-customizations.patch"

if [ ! -d "$TARGET/.git" ]; then
  echo "错误：目标目录不是 git 仓库: $TARGET" >&2
  exit 1
fi

echo "补丁  : $PATCH"
echo "目标  : $TARGET"

git -C "$TARGET" apply --check "$PATCH"
echo "✓ 预检通过"

if [ "$MODE" = "--check" ]; then
  echo "仅检查模式，未实际应用。"
  exit 0
fi

git -C "$TARGET" apply "$PATCH"
echo "✓ 定制补丁已应用。接下来: npm install && npm run build"
echo "  挂载: dsh plugin --profile desktop add link:$TARGET"
