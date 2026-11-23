# typst-studio

Typst の技術書リポジトリを、スマホのブラウザから編集・プレビューするためのツール。Git の操作はコマンドで行う（開発中）。仕様は [docs/spec.md](docs/spec.md)、Phase 0 の検証結果は [docs/phase0-results.md](docs/phase0-results.md)。

## 準備

必要なもの: bash, curl, tar（xz 対応）, git, sha256sum。sudo は不要。

```sh
# typst CLI / tinymist / Noto Sans CJK JP / Noto Sans Mono CJK JP を入れる（何度実行してもよい）
scripts/setup.sh

# 対象リポジトリをプロジェクトとして clone する（既にあればスキップ）
scripts/add-project.sh <name> <git-url>
# 例: scripts/add-project.sh sample-book https://github.com/<owner>/<repo>.git
```

置き場所:

| パス | 中身 |
|---|---|
| `$TYPST_STUDIO_HOME/bin/` | `typst`, `tinymist` |
| `$TYPST_STUDIO_HOME/fonts/` | `NotoSansCJKjp-*.otf`, `NotoSansMonoCJKjp-*.otf`（`--font-path` に渡す） |
| `$TYPST_STUDIO_HOME/projects/<name>/` | プロジェクト（通常の clone、checkout あり） |

## studio サーバーを起動する（開発中）

Node 24 が要る（`source ~/.nvm/nvm.sh`）。`127.0.0.1:8796` で待ち受ける。設定は `$TYPST_STUDIO_HOME/config.toml`（無ければ既定値）。

```sh
npm install
npm run build
npm start            # Ctrl-C で止める（動いている tinymist も止まる）
npm test
```

記事プレビュー（tinymist）は API で起動・停止する。プロジェクト設定は仮に `$TYPST_STUDIO_HOME/project-overrides/<name>.toml` から読む（無ければ `projects/<name>/typst-studio.toml`）。

```sh
curl -X POST -H 'content-type: application/json' \
  -d '{"project":"sample-book","article":"articles/author-a/article.typ"}' \
  http://127.0.0.1:8796/api/preview/start
curl http://127.0.0.1:8796/api/preview/status
curl -X POST http://127.0.0.1:8796/api/preview/stop
```

## git の操作

studio はブランチや worktree を管理しない。git 操作はプロジェクトのディレクトリで、人か Claude がコマンドで行う。

```sh
cd "$TYPST_STUDIO_HOME/projects/<name>"
git switch -c fix/xxx
# 編集
git commit -am "..."
git push
gh pr create
```

## 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `TYPST_STUDIO_HOME` | `${XDG_DATA_HOME:-$HOME/.local/share}/typst-studio` | 置き場所 |
| `TYPST_VERSION` | `0.14.2` | typst CLI の版 |
| `TINYMIST_VERSION` | `0.14.18` | tinymist の版 |
| `NOTO_CJK_REF` | `Sans2.004` | notofonts/noto-cjk のタグ |
| `NOTO_CJK_WEIGHTS` | `Regular Bold` | 入れる Noto Sans CJK JP のウェイト（空白区切り） |
| `NOTO_MONO_CJK_WEIGHTS` | `Regular Bold` | 入れる Noto Sans Mono CJK JP のウェイト（空白区切り） |

対応アーキテクチャは x86_64 / aarch64（`uname -m` で判定）。

## 注意

- typst の版は対象リポジトリの CI と揃える（sample-book は 0.14.2）
- コンパイル例: `typst compile --font-path fonts --font-path "$TYPST_STUDIO_HOME/fonts" main.typ out.pdf`
