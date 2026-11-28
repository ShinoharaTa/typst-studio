#!/usr/bin/env bash
# プロジェクトを追加する（対象リポジトリを通常の clone で置く）
#
# 使い方: add-project.sh <name> <git-url | local-dir>
#   git URL: $TYPST_STUDIO_HOME/projects/<name>/ に clone（checkout あり）
#   ローカルのディレクトリ（例 examples/sample-book）: 中身をコピーし、git init と初回コミットをした
#     独立のリポジトリにする（コピー元の .git は持ち込まない）。author は noreply のアドレス（LOCAL_AUTHOR_NAME / LOCAL_AUTHOR_EMAIL で変えられる）
#   studio はブランチや worktree を管理しない。git 操作はこのディレクトリでコマンドで行う
# 何度実行しても同じ結果になる。ディレクトリがあればスキップする。
set -euo pipefail

TYPST_STUDIO_HOME="${TYPST_STUDIO_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/typst-studio}"
# ローカルのディレクトリから作るときの初回コミットの author / committer
LOCAL_AUTHOR_NAME="${LOCAL_AUTHOR_NAME:-typst-studio}"
LOCAL_AUTHOR_EMAIL="${LOCAL_AUTHOR_EMAIL:-noreply@typst-studio.invalid}"

log() { printf '[add-project] %s\n' "$*" >&2; }
die() { printf '[add-project] error: %s\n' "$*" >&2; exit 1; }

[ $# -eq 2 ] || die "usage: $0 <name> <git-url | local-dir>"
NAME="$1"
SRC="$2"

case "$NAME" in
  ''|*/*|.*) die "invalid name: $NAME" ;;
esac

PROJECT_DIR="$TYPST_STUDIO_HOME/projects/$NAME"

if [ -e "$PROJECT_DIR" ]; then
  log "$PROJECT_DIR already exists, skip"
elif [ -d "$SRC" ]; then
  [ -f "$SRC/typst-studio.toml" ] || die "$SRC has no typst-studio.toml"
  mkdir -p "$(dirname "$PROJECT_DIR")"
  # 途中で失敗しても中途半端なディレクトリを残さない（できあがってから rename する）
  TMP_DIR="$(mktemp -d "$(dirname "$PROJECT_DIR")/.add-project.XXXXXX")"
  trap 'rm -rf "$TMP_DIR"' EXIT
  log "copying $SRC -> $PROJECT_DIR"
  tar -C "$SRC" --exclude=./.git -cf - . | tar -C "$TMP_DIR" -xf -
  git -C "$TMP_DIR" init -q -b main
  git -C "$TMP_DIR" add -A
  GIT_AUTHOR_NAME="$LOCAL_AUTHOR_NAME" GIT_AUTHOR_EMAIL="$LOCAL_AUTHOR_EMAIL" \
    GIT_COMMITTER_NAME="$LOCAL_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$LOCAL_AUTHOR_EMAIL" \
    git -C "$TMP_DIR" commit -q -m "Initial commit (copied from $(basename "$SRC"))"
  chmod u=rwx,go=rx "$TMP_DIR"   # mktemp -d は 0700 で作る
  mv "$TMP_DIR" "$PROJECT_DIR"
  trap - EXIT
else
  mkdir -p "$(dirname "$PROJECT_DIR")"
  log "cloning $SRC -> $PROJECT_DIR"
  git clone "$SRC" "$PROJECT_DIR"
fi

log "project: $PROJECT_DIR"
