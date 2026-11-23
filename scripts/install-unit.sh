#!/usr/bin/env bash
# typst-studio の user unit を生成する（deploy/systemd/typst-studio.service.in から）
#
# 使い方: install-unit.sh [--dest <dir>] [--enable]
#   --dest <dir>  生成先（既定 ${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user）
#   --enable      生成後に systemctl --user daemon-reload と enable --now を行う（既定の生成先のときだけ）
# node は PATH の node（先に source ~/.nvm/nvm.sh）か、環境変数 NODE で指定する。
# 何度実行しても同じ結果になる（unit は上書きする）。
set -euo pipefail

log() { printf '[install-unit] %s\n' "$*" >&2; }
die() { printf '[install-unit] error: %s\n' "$*" >&2; exit 1; }

DEFAULT_DEST="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
DEST="$DEFAULT_DEST"
ENABLE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) [ $# -ge 2 ] || die "--dest needs a directory"; DEST="$2"; shift 2 ;;
    --enable) ENABLE=1; shift ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$APP_DIR/deploy/systemd/typst-studio.service.in"
UNIT=typst-studio.service

NODE="${NODE:-$(command -v node || true)}"
[ -n "$NODE" ] && [ -x "$NODE" ] || die "node not found (source ~/.nvm/nvm.sh first, or set NODE=/path/to/node)"
NODE="$(readlink -f "$NODE")"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || die "node >= 24 is required ($NODE is v$("$NODE" -p process.versions.node))"

for v in "$APP_DIR" "$NODE"; do
  case "$v" in *[[:space:]@\|\\\&]*) die "path contains unsupported characters: $v" ;; esac
done
[ -f "$APP_DIR/server/dist/main.js" ] || log "warning: server/dist/main.js is missing (run npm run build)"

if [ "$ENABLE" = 1 ] && [ "$(readlink -m "$DEST")" != "$(readlink -m "$DEFAULT_DEST")" ]; then
  die "--enable works only with the default destination ($DEFAULT_DEST)"
fi

mkdir -p "$DEST"
tmp="$(mktemp "$DEST/.$UNIT.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
# 先頭のテンプレート用コメントは落とす
sed -e '1,/^\[Unit\]/{/^#/d}' -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@NODE@|$NODE|g" "$TEMPLATE" > "$tmp"
if grep -q '@[A-Z_]*@' "$tmp"; then die "unreplaced placeholder in $TEMPLATE"; fi
chmod 644 "$tmp"
mv "$tmp" "$DEST/$UNIT"
trap - EXIT
log "wrote $DEST/$UNIT"

if [ "$ENABLE" = 1 ]; then
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT"
  log "enabled and started $UNIT"
else
  log "next: systemctl --user daemon-reload && systemctl --user enable --now $UNIT"
fi
