#!/usr/bin/env bash
# プロジェクトを追加する（対象リポジトリを通常の clone で置く）
#
# 使い方: add-project.sh <name> <git-url | local-dir>
#   git URL・ローカルの git リポジトリ（bare を含む）: $TYPST_STUDIO_HOME/projects/<name>/ に clone（checkout あり）
#   git リポジトリでないディレクトリ（例 examples/sample-book。親リポジトリの中の一部も含む）: 中身をコピーし、
#     git init と初回コミットをした独立のリポジトリにする。typst-studio.toml が要る。
#     入れ子の .git や、コピー元の外を指すシンボリックリンクがあれば止める。author は noreply のアドレス（LOCAL_AUTHOR_NAME / LOCAL_AUTHOR_EMAIL で変えられる）
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

# server/src/config.ts の PROJECT_NAME_RE と揃える
[[ "$NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "invalid name: $NAME"

# ローカルの git リポジトリか（bare、または作業ツリーの最上位）。親リポジトリの中の一部は含めない
is_local_repo() {
  [ -d "$1" ] || return 1
  [ "$(git -C "$1" rev-parse --is-bare-repository 2>/dev/null)" = true ] && return 0
  local top
  top="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null)" || return 1
  [ "$(realpath "$top")" = "$(realpath "$1")" ]
}

# コピーしてよいか: 入れ子の .git が無く、シンボリックリンクがコピー元の中を指す
check_copy_source() {
  local src nested link target
  src="$(realpath "$1")"
  nested="$(find "$src" -name .git -print -quit)"
  [ -z "$nested" ] || die "nested git repository: $nested"
  while IFS= read -r -d '' link; do
    target="$(realpath -m "$link")"
    case "$target" in
      "$src"|"$src"/*) ;;
      *) die "symlink points outside $1: $link -> $(readlink "$link")" ;;
    esac
  done < <(find "$src" -type l -print0)
}

PROJECT_DIR="$TYPST_STUDIO_HOME/projects/$NAME"

if [ -e "$PROJECT_DIR" ]; then
  log "$PROJECT_DIR already exists, skip"
elif [ -d "$SRC" ] && ! is_local_repo "$SRC"; then
  [ -f "$SRC/typst-studio.toml" ] || die "$SRC has no typst-studio.toml"
  check_copy_source "$SRC"
  mkdir -p "$(dirname "$PROJECT_DIR")"
  # 途中で失敗しても中途半端なディレクトリを残さない（できあがってから rename する）
  TMP_DIR="$(mktemp -d "$(dirname "$PROJECT_DIR")/.add-project.XXXXXX")"
  trap 'rm -rf "$TMP_DIR"' EXIT
  log "copying $SRC -> $PROJECT_DIR"
  tar -C "$SRC" --exclude=.git -cf - . | tar -C "$TMP_DIR" -xf -
  git -C "$TMP_DIR" init -q -b main
  git -C "$TMP_DIR" add -A
  GIT_AUTHOR_NAME="$LOCAL_AUTHOR_NAME" GIT_AUTHOR_EMAIL="$LOCAL_AUTHOR_EMAIL" \
    GIT_COMMITTER_NAME="$LOCAL_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$LOCAL_AUTHOR_EMAIL" \
    git -C "$TMP_DIR" commit -q -m "Initial commit (copied from $(basename "$SRC"))"
  chmod "$(printf '%o' $((0777 & ~$(umask))))" "$TMP_DIR"   # mktemp -d は 0700 で作るので umask に戻す
  mv -T "$TMP_DIR" "$PROJECT_DIR"
  trap - EXIT
else
  mkdir -p "$(dirname "$PROJECT_DIR")"
  log "cloning $SRC -> $PROJECT_DIR"
  git clone "$SRC" "$PROJECT_DIR"
fi

log "project: $PROJECT_DIR"
