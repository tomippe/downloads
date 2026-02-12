#!/bin/bash
set -e

# ===== Downloads Side Panel ビルドスクリプト (Chrome拡張) =====

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="download-sidepanel"
ZIP_NAME="${APP_NAME}.zip"

# 共通スクリプト読み込み
source "$SCRIPT_DIR/../build-common/version.sh"
source "$SCRIPT_DIR/../build-common/git-commit.sh"

# ===== オプション解析 =====
COMMIT_MSG=""
NO_VERUP=false
while [ $# -gt 0 ]; do
    case "$1" in
        -cm) shift; COMMIT_MSG="$1" ;;
        -noverup) NO_VERUP=true ;;
    esac
    shift || true
done

# バージョン読み込み
VERSION=$(version_read)

echo "🔧 ${APP_NAME} v${VERSION} をビルド中..."

# manifest.json にバージョンを埋め込み
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" manifest.json
echo "  ✓ manifest.json を v${VERSION} に更新しました"

# zip作成
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" . \
    -x "*.git*" \
    -x "*.DS_Store" \
    -x "build.sh" \
    -x "release.sh" \
    -x "version.txt" \
    -x "*.zip" \
    -x "icons/*.svg" \
    -x "icons/original.png" \
    -x "README.md" \
    -x ".gitignore"

echo ""
echo "✅ ${ZIP_NAME} (v${VERSION}) を作成しました"
echo "📦 場所: $(pwd)/${ZIP_NAME}"

# 次回用バージョン保存
if ! $NO_VERUP; then
    echo ""
    echo "📝 次回用バージョンを更新しています..."
    version_save_next "$VERSION"
fi

# Git コミット
git_commit_build "$VERSION" "$COMMIT_MSG"
