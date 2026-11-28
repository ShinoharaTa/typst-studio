#!/usr/bin/env bash
# サンプルの本で使うプレースホルダー画像を作る（描画は typst CLI で行う）
#
# 使い方: tools/gen-images.sh
#   tools/placeholder.typ を --ppi 72（1pt = 1px）で PNG にし、各記事の images/ に置く
#   既にある PNG は上書きする。最後に tools/recompress-png.py（python3 の標準ライブラリのみ）で圧縮し直す
set -euo pipefail

TYPST_STUDIO_HOME="${TYPST_STUDIO_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/typst-studio}"
TYPST="${TYPST:-$TYPST_STUDIO_HOME/bin/typst}"
FONT_DIR="${FONT_DIR:-$TYPST_STUDIO_HOME/fonts}"

BOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$BOOK_DIR/tools/placeholder.typ"

log() { printf '[gen-images] %s\n' "$*" >&2; }
die() { printf '[gen-images] error: %s\n' "$*" >&2; exit 1; }

[ -x "$TYPST" ] || die "typst not found: $TYPST (run scripts/setup.sh)"
command -v python3 >/dev/null || die "python3 not found"

# 出力先（本のディレクトリ相対） 幅 高さ 比率 色相
IMAGES=(
  "articles/author-a/intro/images/square-1x1.png    1200 1200 1:1  210"
  "articles/author-a/intro/images/wide-16x9.png     1920 1080 16:9 150"
  "articles/author-a/layout/images/landscape-4x3.png 1600 1200 4:3  30"
  "articles/author-a/layout/images/portrait-3x4.png  900  1200 3:4  300"
  "articles/author-b/images/icon-1x1.png             256  256  1:1  90"
)

outs=()
for spec in "${IMAGES[@]}"; do
  read -r out w h ratio hue <<<"$spec"
  mkdir -p "$BOOK_DIR/$(dirname "$out")"
  log "$out (${w}x${h}, $ratio)"
  "$TYPST" compile --format png --ppi 72 \
    --ignore-system-fonts --font-path "$FONT_DIR" \
    --input "W=$w" --input "H=$h" --input "RATIO=$ratio" --input "HUE=$hue" \
    "$SRC" "$BOOK_DIR/$out"
  outs+=("$BOOK_DIR/$out")
done

python3 -I "$BOOK_DIR/tools/recompress-png.py" "${outs[@]}"
