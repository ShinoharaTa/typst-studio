#!/usr/bin/env bash
# typst-studio の実行環境を用意する（typst CLI / tinymist / Noto Sans CJK JP / Noto Sans Mono CJK JP）
#
# 置き場:   $TYPST_STUDIO_HOME（既定 ${XDG_DATA_HOME:-$HOME/.local/share}/typst-studio）
#             bin/    typst, tinymist
#             fonts/  NotoSansCJKjp-*.otf, NotoSansMonoCJKjp-*.otf
# 必要なもの: bash, curl, tar(+xz), git, sha256sum
# 何度実行しても同じ結果になる。入っているものはスキップする。
set -euo pipefail

TYPST_VERSION="${TYPST_VERSION:-0.14.2}"
TINYMIST_VERSION="${TINYMIST_VERSION:-0.14.18}"
# notofonts/noto-cjk のタグと、入れるウェイト（空白区切り）
NOTO_CJK_REF="${NOTO_CJK_REF:-Sans2.004}"
NOTO_CJK_WEIGHTS="${NOTO_CJK_WEIGHTS:-Regular Bold}"
NOTO_MONO_CJK_WEIGHTS="${NOTO_MONO_CJK_WEIGHTS:-Regular Bold}"

TYPST_STUDIO_HOME="${TYPST_STUDIO_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/typst-studio}"
BIN_DIR="$TYPST_STUDIO_HOME/bin"
FONT_DIR="$TYPST_STUDIO_HOME/fonts"

log() { printf '[setup] %s\n' "$*" >&2; }
die() { printf '[setup] error: %s\n' "$*" >&2; exit 1; }

case "$(uname -m)" in
  x86_64)        TYPST_ARCH=x86_64;  TINYMIST_ASSET=tinymist-linux-x64 ;;
  aarch64|arm64) TYPST_ARCH=aarch64; TINYMIST_ASSET=tinymist-linux-arm64 ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac
TYPST_ASSET="typst-${TYPST_ARCH}-unknown-linux-musl.tar.xz"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/typst-studio-setup.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }

# GitHub releases API から asset の sha256 を取り出す。取れなければ空文字
release_digest() { # <owner/repo> <tag> <asset>
  local json="$TMP_DIR/release-${1//\//_}-$2.json"
  [ -f "$json" ] || curl -fsSL "https://api.github.com/repos/$1/releases/tags/$2" -o "$json" 2>/dev/null || : > "$json"
  awk -v want="\"name\": \"$3\"," '
    index($0, want) { hit = 1; next }
    hit && /"name": / { hit = 0 }
    hit && /"digest": "sha256:/ { sub(/.*"sha256:/, ""); sub(/".*/, ""); print; exit }
  ' "$json"
}

verify_sha256() { # <file> <expected or empty> <label>
  if [ -z "$2" ]; then
    log "warn: sha256 for $3 not available, skipped verification"
    return 0
  fi
  local actual
  actual="$(sha256sum "$1" | cut -d' ' -f1)"
  [ "$actual" = "$2" ] || die "sha256 mismatch for $3 (expected $2, got $actual)"
  log "sha256 ok: $3"
}

install_typst() {
  local dest="$BIN_DIR/typst"
  if [ -x "$dest" ] && "$dest" --version 2>/dev/null | grep -q "^typst $TYPST_VERSION "; then
    log "typst $TYPST_VERSION already installed, skip"
    return
  fi
  local tag="v$TYPST_VERSION" archive="$TMP_DIR/$TYPST_ASSET"
  log "downloading $TYPST_ASSET ($tag)"
  fetch "https://github.com/typst/typst/releases/download/$tag/$TYPST_ASSET" "$archive"
  verify_sha256 "$archive" "$(release_digest typst/typst "$tag" "$TYPST_ASSET")" "$TYPST_ASSET"
  tar -xJf "$archive" -C "$TMP_DIR"
  install -m 0755 "$TMP_DIR/${TYPST_ASSET%.tar.xz}/typst" "$dest"
  log "installed $("$dest" --version)"
}

install_tinymist() {
  local dest="$BIN_DIR/tinymist"
  if [ -x "$dest" ] && "$dest" -V 2>/dev/null | grep -qx "tinymist $TINYMIST_VERSION"; then
    log "tinymist $TINYMIST_VERSION already installed, skip"
    return
  fi
  local tag="v$TINYMIST_VERSION" file="$TMP_DIR/$TINYMIST_ASSET"
  log "downloading $TINYMIST_ASSET ($tag)"
  fetch "https://github.com/Myriad-Dreamin/tinymist/releases/download/$tag/$TINYMIST_ASSET" "$file"
  verify_sha256 "$file" "$(release_digest Myriad-Dreamin/tinymist "$tag" "$TINYMIST_ASSET")" "$TINYMIST_ASSET"
  install -m 0755 "$file" "$dest"
  log "installed $("$dest" -V 2>/dev/null | head -n1)"
}

# noto-cjk の contents API が返す git blob sha（sha1）で検証する
install_fonts() { # <dir in noto-cjk> <file prefix> <weights>
  local dir_path="$1" prefix="$2" weights="$3"
  local listing="$TMP_DIR/noto-cjk-listing-${dir_path//\//_}.json"
  curl -fsSL "https://api.github.com/repos/notofonts/noto-cjk/contents/$dir_path?ref=$NOTO_CJK_REF" -o "$listing" 2>/dev/null || : > "$listing"
  local w name dest blob expected
  for w in $weights; do
    name="$prefix-$w.otf"
    dest="$FONT_DIR/$name"
    expected="$(awk -v want="\"name\": \"$name\"," '
      index($0, want) { hit = 1; next }
      hit && /"sha": / { sub(/.*"sha": "/, ""); sub(/".*/, ""); print; exit }
    ' "$listing")"
    if [ -f "$dest" ]; then
      blob="$(git hash-object --no-filters "$dest")"
      if [ -z "$expected" ] || [ "$blob" = "$expected" ]; then
        log "$name already installed, skip"
        continue
      fi
      log "$name differs from $NOTO_CJK_REF, re-downloading"
    fi
    log "downloading $name ($NOTO_CJK_REF)"
    fetch "https://raw.githubusercontent.com/notofonts/noto-cjk/$NOTO_CJK_REF/$dir_path/$name" "$TMP_DIR/$name"
    if [ -n "$expected" ]; then
      blob="$(git hash-object --no-filters "$TMP_DIR/$name")"
      [ "$blob" = "$expected" ] || die "git blob sha mismatch for $name (expected $expected, got $blob)"
      log "blob sha ok: $name"
    else
      log "warn: blob sha for $name not available, skipped verification"
    fi
    install -m 0644 "$TMP_DIR/$name" "$dest"
  done
}

command -v curl >/dev/null || die "curl is required"
command -v tar >/dev/null || die "tar is required"
command -v git >/dev/null || die "git is required"
command -v sha256sum >/dev/null || die "sha256sum is required"

mkdir -p "$BIN_DIR" "$FONT_DIR"
install_typst
install_tinymist
install_fonts Sans/OTF/Japanese NotoSansCJKjp "$NOTO_CJK_WEIGHTS"
install_fonts Sans/Mono NotoSansMonoCJKjp "$NOTO_MONO_CJK_WEIGHTS"
log "done: $TYPST_STUDIO_HOME"
