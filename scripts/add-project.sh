#!/usr/bin/env bash
# プロジェクトを追加する（対象リポジトリを通常の clone で置く）
#
# 使い方: add-project.sh <name> <git-url>
#   $TYPST_STUDIO_HOME/projects/<name>/ に clone（checkout あり）
#   studio はブランチや worktree を管理しない。git 操作はこのディレクトリでコマンドで行う
# 何度実行しても同じ結果になる。ディレクトリがあればスキップする。
set -euo pipefail

TYPST_STUDIO_HOME="${TYPST_STUDIO_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/typst-studio}"

log() { printf '[add-project] %s\n' "$*" >&2; }
die() { printf '[add-project] error: %s\n' "$*" >&2; exit 1; }

[ $# -eq 2 ] || die "usage: $0 <name> <git-url>"
NAME="$1"
URL="$2"

case "$NAME" in
  ''|*/*|.*) die "invalid name: $NAME" ;;
esac

PROJECT_DIR="$TYPST_STUDIO_HOME/projects/$NAME"

if [ -e "$PROJECT_DIR" ]; then
  log "$PROJECT_DIR already exists, skip"
else
  mkdir -p "$(dirname "$PROJECT_DIR")"
  log "cloning $URL -> $PROJECT_DIR"
  git clone "$URL" "$PROJECT_DIR"
fi

log "project: $PROJECT_DIR"
