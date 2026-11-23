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

Node 24 が要る（`source ~/.nvm/nvm.sh`）。既定で `127.0.0.1:8796` で待ち受ける。

```sh
npm install
npm run build
npm start            # Ctrl-C で止める（動いている tinymist も止まる）
npm test
```

### ホスト側の設定 `$TYPST_STUDIO_HOME/config.toml`

無ければ既定値で動く（既定の `auth.mode = "external"` は認証を前段のプロキシ（Cloudflare Access など）に任せる）。curl から API を叩く開発時は次を書く。未知のキーは起動時エラー。

```toml
[auth]
mode = "none"               # 開発用。認証しない（curl から API を叩ける）
```

全キー（値は既定。詳細は spec 10.3）:

```toml
[server]
bind = "127.0.0.1"          # ループバック以外は TYPST_STUDIO_CONTAINER=1 のときだけ
port = 8796
public_url = "https://studio.example.test:8445"   # tailscale serve の URL。既定なし。Origin 検査の許可値になる

[auth]
mode = "external"           # "external"（前段のプロキシで認証）/ "tailscale" / "none"（開発用）
# allow_users = ["<Tailscale のログイン名>"]          # mode = "tailscale" では必須。大文字小文字を区別して完全一致

[limits]
driver = "auto"             # auto / systemd-scope / watchdog / none
watchdog_interval_ms = 250

[preview]                   # tinymist（記事）
data_plane_port = 23625
control_plane_port = 23626
memory_max = "600M"
cpu_quota = "200%"          # systemd-scope のみ有効
idle_stop_minutes = 10

[build]                     # typst compile（本全体）
memory_max = "1500M"
timeout_seconds = 300
auto_on_save = true
auto_debounce_seconds = 5
keep_generations = 2

[fonts]
extra_paths = ["fonts"]     # $TYPST_STUDIO_DIST 相対
```

- 認証（`auth.mode = "external"`、既定）: ユーザーの照合はしない。前段（Cloudflare Access など）で認証済みの前提。Origin 検査とパスの検査は行う
- 認証（`auth.mode = "tailscale"`）: `Tailscale-User-Login` ヘッダがあれば `allow_users` と照合し（大文字小文字を区別した完全一致）、外れたら 403。ヘッダが無いリクエストは `/mcp` と `/healthz` だけ通し、他は 401。パスに `..` `%2e` `//` などを含み、正規化すると形が変わるリクエストは 400
- POST などの状態を変えるリクエストと WebSocket の接続は、`Origin` が `public_url` のオリジンと一致しなければ 403。`Origin` 無しは `auth.mode = "none"` のとき（curl）と、HTTP の `/mcp` `/healthz` だけ通す
- コンテナ（`TYPST_STUDIO_CONTAINER=1`）でループバック以外に bind するときは `auth.mode = "none"` にできない
- プロセス制限ドライバ: `auto` は `systemd-run --user --scope` が使えれば `systemd-scope`（厳密）、使えなければ `watchdog`（RSS の見張り + typst には `prlimit --as`）。`none` は上限なし。選ばれたドライバは起動ログに 1 行出る。起動時に、前回の studio が異常終了して残した子（`typst-studio-*.scope`、または `$TYPST_STUDIO_HOME/state/children/` に記録した子）を止める

### プロジェクト側の設定 `typst-studio.toml`

リポジトリ直下の `typst-studio.toml` を読む。無ければ仮の置き場 `$TYPST_STUDIO_HOME/project-overrides/<name>.toml` を読む。キーは spec 2.3。`[project]`（`typst` 必須）・`[book]`（`entry` 必須）・`[articles]`（`glob` 必須）が要る。未知のキー（`[git]` やホスト側のキーを含む）、存在しないパス、リポジトリ外を指すパス、`{article_entry}` 以外のプレースホルダ、`[profiles.*]` に無い `book.preview_profile` は検証エラー。

```toml
[project]
typst = "0.14.2"

[book]
entry = "main.typ"
preview_profile = "print"

[preview]
entry = "preview.typ"
inputs = { ARTICLE = "{article_entry}" }

[articles]
glob = "articles/**/article.typ"

[profiles.print]
entry = "main.typ"
output = "main.pdf"
```

### 記事プレビュー

記事プレビュー（tinymist）は API で起動・停止する（`auth.mode = "none"` の例）。上限で止まったときは 1 回だけ自動で起動し直す。

```sh
curl -X POST -H 'content-type: application/json' \
  -d '{"project":"sample-book","article":"articles/author-a/article.typ"}' \
  http://127.0.0.1:8796/api/preview/start
curl http://127.0.0.1:8796/api/preview/status
curl -X POST http://127.0.0.1:8796/api/preview/stop
```

## user unit で常駐させる

`systemctl --user` の unit として動かす（linger 有効が前提）。テンプレートは `deploy/systemd/typst-studio.service.in`。

```sh
source ~/.nvm/nvm.sh        # unit の ExecStart に今の node の絶対パスを書く（NODE=/path/to/node でも可）
npm run build
scripts/install-unit.sh                     # ~/.config/systemd/user/typst-studio.service を作るだけ
scripts/install-unit.sh --enable            # 作って daemon-reload・enable --now まで行う
scripts/install-unit.sh --dest /tmp/unit    # 別の場所に作って中身を確かめる（--enable とは併用不可）

systemctl --user status typst-studio
journalctl --user -u typst-studio -f
```

node の版を上げたら作り直す（`ExecStart` が node の絶対パスを持つため）。

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
| `TYPST_STUDIO_DIST` | `$TYPST_STUDIO_HOME` | studio が `bin/` と `fonts/` を読む場所（書き込まない） |
| `TYPST_STUDIO_CONTAINER` | 未設定 | `1` のときだけ `server.bind` にループバック以外を許す（コンテナ用） |
| `TYPST_VERSION` | `0.14.2` | typst CLI の版 |
| `TINYMIST_VERSION` | `0.14.18` | tinymist の版 |
| `NOTO_CJK_REF` | `Sans2.004` | notofonts/noto-cjk のタグ |
| `NOTO_CJK_WEIGHTS` | `Regular Bold` | 入れる Noto Sans CJK JP のウェイト（空白区切り） |
| `NOTO_MONO_CJK_WEIGHTS` | `Regular Bold` | 入れる Noto Sans Mono CJK JP のウェイト（空白区切り） |

対応アーキテクチャは x86_64 / aarch64（`uname -m` で判定）。

## 注意

- typst の版は対象リポジトリの CI と揃える（sample-book は 0.14.2）
- コンパイル例: `typst compile --font-path fonts --font-path "$TYPST_STUDIO_HOME/fonts" main.typ out.pdf`
