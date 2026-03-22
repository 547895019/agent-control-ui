#!/usr/bin/env bash
# release.sh — 一键构建并发布 agent-control-ui
# 版本规则：YYYY.M.D，若 tag 已存在则加 -1, -2 ...
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_NAME="agent-control-ui"

# ── 1. 计算版本号 ────────────────────────────────────────────────────────────
YEAR=$(date +%Y)
MONTH=$(date +%-m)   # 无前导零
DAY=$(date +%-d)
BASE_VERSION="${YEAR}.${MONTH}.${DAY}"

# 检查 tag 是否已存在，冲突时追加 -N
VERSION="$BASE_VERSION"
SUFFIX=0
while gh release view "v${VERSION}" &>/dev/null; do
  SUFFIX=$((SUFFIX + 1))
  VERSION="${BASE_VERSION}-${SUFFIX}"
done

echo "📦 版本：v${VERSION}"

# ── 2. 更新 package.json 版本号 ──────────────────────────────────────────────
cd "$PROJECT_DIR"
# 用 node 替换避免 sed 的 BSD/GNU 差异
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '${VERSION}';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "✅ package.json → ${VERSION}"

# ── 3. 构建 ──────────────────────────────────────────────────────────────────
echo "🔨 构建中..."
npm run build
echo "✅ 构建完成"

# ── 4. 打包 tgz（npm 规范：内容在 package/ 目录下）──────────────────────────
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/package/bin"
cp -r dist                  "$TMP_DIR/package/"
cp    bin/cli.mjs           "$TMP_DIR/package/bin/"
cp    server.mjs            "$TMP_DIR/package/"
cp    localfile-server.mjs  "$TMP_DIR/package/"
cp    package.json          "$TMP_DIR/package/"
cp    README.md             "$TMP_DIR/package/" 2>/dev/null || true

TGZ_PATH="$TMP_DIR/${PACKAGE_NAME}.tgz"
(cd "$TMP_DIR" && tar -czf "${PACKAGE_NAME}.tgz" package/)
echo "✅ 打包完成：$(du -h "$TGZ_PATH" | cut -f1)"

# ── 5. 提交版本号变更 ────────────────────────────────────────────────────────
git add package.json
git commit -m "chore: release v${VERSION}"
git push

# ── 6. 创建 GitHub Release 并上传 tgz ───────────────────────────────────────
echo "🚀 创建 release v${VERSION}..."
gh release create "v${VERSION}" \
  --title "v${VERSION}" \
  --notes "Release v${VERSION}" \
  "$TGZ_PATH"

echo ""
echo "✅ 发布完成！"
echo "   Tag     : v${VERSION}"
echo "   下载    : https://github.com/547895019/${PACKAGE_NAME}/releases/download/v${VERSION}/${PACKAGE_NAME}.tgz"
echo "   安装    : npm install -g https://github.com/547895019/${PACKAGE_NAME}/releases/latest/download/${PACKAGE_NAME}.tgz"
