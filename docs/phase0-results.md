# Phase 0 検証結果

- 計測日: 2026-11-23
- 環境: N100（4 コア）/ RAM 16GB（空き約 2.4GB、swap 満杯）/ Ubuntu 24.04
- 対象: sample-bookを `scripts/clone-repo.sh` で studio 専用クローンし、worktree `studio/phase0` 上で計測
- ツール: typst 0.14.2（musl 配布バイナリ）、tinymist 0.14.18（`tinymist-linux-x64`。`-V` の Typst Version は 0.14.2、Typst Source はフォーク `tinymist/v0.14.6-rc2`）
- フォント: `--font-path fonts` と `--font-path $TYPST_STUDIO_HOME/fonts`（Noto Sans CJK JP Regular / Bold）
- 記事単体の計測対象: `preview.typ` + `--input ARTICLE=articles/author-a/article.typ`（`CATEGORY` は既定値）
- 本全体: `main.typ`（印刷版、90 ページ）

## 判定項目

| 項目 | 計測値 | 合否案 |
|---|---|---|
| プレビューをプロキシ越しに埋め込める | プロキシは未構築。前提条件は下の「プレビュー（P1）」に記載。WebSocket の接続先はページの URL から導出される（ホスト固定値の埋め込みは無い）。Origin は `127.0.0.1` / `localhost`（ポート問わず）と Origin 無しを受け付け、tailnet のホスト名・IP は切断 | 未確認（プロキシで Origin を付け替えれば繋がる見込み） |
| 記事単体の再コンパイルが体感 2 秒以内 | tinymist で 1 行追記 → 再コンパイル **33.5ms**、データプレーンに差分（5.9KB）が届くまで **42ms**。初回コンパイル 0.54〜0.58s | 合格 |
| tinymist のメモリが 1.2GB 以内 | 記事単体: 最大 RSS **256MB**。本全体: 最大 RSS（VmHWM）**1,029MB**（上限 1,200MB の 86%） | 合格（本全体は余裕 15% 弱） |
| tinymist 0.14 系と typst 0.14.2 の出力差が目視で無い | `compile --format png` で記事 p1 / p3 を出力。p3 はファイルのハッシュが一致。p1 は 6,014,496 バイト中 3 バイトの画素差（下記） | 未確認（人が目視で判定） |
| `typst-studio.toml` の追加だけで参考リポジトリが開ける | studio 本体が未実装のため未検証。リポジトリのファイルを一切変更せずに、本全体・記事単体とも typst / tinymist でコンパイルできた（下の「補足」参照） | 未確認 |

## 1. typst 0.14.2 のコンパイル（`/usr/bin/time -v`）

3 回ずつ実行。`~/.cache/typst` のパッケージは 1 回目より前に取得済み。

| 対象 | 経過時間 | 最大 RSS | 終了コード | 警告 |
|---|---|---|---|---|
| 本全体 `main.typ` | 3.69〜3.75s（初回 4.26s） | 991〜995MB | 0 | 2 件 |
| 記事単体 `preview.typ` | 0.99〜1.01s | 242MB | 0 | 0 件 |

警告の種類（本全体のみ）
- `unknown font family: noto sans mono cjk jp`（`template.typ` のコード用フォント。theme.typ の `mono` が指定）× 1
- `variable fonts are not currently supported and may render incorrectly`（リポジトリ同梱の可変フォント）× 1

PDF に埋め込まれたフォント（本全体・電子版とも）: ArchivoBlack, IPAGothic, NotoEmoji, NotoSansCJKjp-Regular, NotoSansCJKjp-Bold, RoundedMplus1c（Regular/Bold/Black）, SpaceMono（Regular/Bold）。
IPAGothic はシステムフォントで、Noto Sans Mono CJK JP が無いために代わりに使われたものと見られる [推測]。

## 2. メモリ上限（`systemd-run --user --scope -p MemoryMax=1200M`）

| 確認 | 結果 |
|---|---|
| user manager に memory コントローラが委譲されているか | `cpu memory pids`（委譲済み） |
| scope 内の `memory.max` | `1258291200`（= 1200M）。`memory.swap.max` は `max` |
| 本全体を `MemoryMax=1200M` で | 成功。3.84s / 978MB |
| 記事単体を `MemoryMax=1200M` で | 成功。1.03s / 242MB |
| 効いているかの確認: 本全体を `MemoryMax=300M -p MemorySwapMax=0` で | 約 1 秒で OOM kill。journal に `A process of this unit has been killed by the OOM killer` / `Failed with result 'oom-kill'` |

**ユーザー scope でメモリ上限は効く。** ただし `MemorySwapMax` を指定しないと swap 側は無制限（現状 swap は満杯なので実質効かないが、空いていれば swap に逃げる）。

## 3. プレビュー（P1: `tinymist preview`）

### 起動とフラグ
起動コマンド（worktree をカレントにして実行）:
```
tinymist preview --no-open \
  --data-plane-host 127.0.0.1:23625 --control-plane-host 127.0.0.1:23626 \
  --root <worktree> --font-path <worktree>/fonts:$TYPST_STUDIO_HOME/fonts \
  --input ARTICLE=articles/author-a/article.typ preview.typ
```

| フラグ | `--help` | 実際の起動 |
|---|---|---|
| `--input` | あり | 通る。起動ログの `inputs` に反映され、指定記事が描画された（初回データ 10.3MB） |
| `--font-path` | あり（**複数指定は `:` 区切り**。`TYPST_FONT_PATHS` でも可） | 通る |
| `--root` | あり | 通る |
| `--data-plane-host` / `--control-plane-host` | **`--help` に出ない**（隠しフラグ） | 受け付けられ、両方とも `127.0.0.1` で LISTEN |
| `--host` | 「Deprecated」と表示 | 未使用。指定しないと静的ファイルはデータプレーンと同じポートで配信 |

### 静的ページと WebSocket の接続先
- `GET http://127.0.0.1:23625/` → **200**、`text/html`、1,647,695 バイト（JS 同梱の 1 ファイル）
- `GET http://127.0.0.1:23626/` → 200
- 接続先はページ内の `retrieveWsArgs()` が `new URL("/", window.location.href)` から作り、`http:`→`ws:` / `https:`→`wss:` に置換する。**ホスト・ポートの埋め込みは無く、ページと同じオリジンのルート `/` に繋ぐ。**
  - プロキシでサブパス（例 `/preview/`）に置くと、WebSocket はホストのルート `/` に向かう。ルート以外に置くなら、HTML の書き換えかルートでの振り分けが要る
- ページ内に `preview-arg:previewMode:` などの置換用プレースホルダがある
- 接続後、クライアントは文字列 `current` を送り、サーバーが全ページ分を返す（記事単体 10.3MB、本全体 44.3MB を 1 メッセージ）

### Origin 検査（Node 24 で WebSocket ハンドシェイクを送って確認）

| Origin | データプレーン 23625 |
|---|---|
| `http://127.0.0.1:23625` | 101（接続維持） |
| `http://localhost:23625` | 101 |
| `http://127.0.0.1:8796` / `http://localhost:8796` / `http://127.0.0.1` | 101（ポートは見ていない） |
| 無し | 101。ただしログに `websocket connection is not set Origin header, which will be a hard error in the future` |
| `https://<name>.ts.net`（tailnet 想定） | 切断（socket hang up） |
| `https://127.0.0.1:8445` | 切断 |
| `http://100.127.162.85:8796`（tailnet IP）/ `http://10.1.111.70:23625`（LAN IP）/ `http://127.0.0.2:23625` | 切断 |
| `null` | 切断 |

→ 許可されるのは `http://127.0.0.1` / `http://localhost`（任意ポート）。中継サーバーが Origin を `http://127.0.0.1:<port>` に付け替えれば通る。

### コントロールプレーンの挙動（注意）
- コントロールプレーンは**エディタ 1 本の接続**を前提にしている。接続を切ると、コントロールプレーンのサーバーが閉じ、2 本目の接続は `ECONNREFUSED` になった
- 1 回目の試行では、切断後に `EditorActor: editor disconnected` → `shutting down whole program` となり **tinymist が終了**した。2 回目（制御接続を張ったまま計測し、最後に閉じた）では、プロセスはデータプレーンを開いたまま残った。挙動が一定しないので、studio は**制御接続を tinymist の寿命中ずっと保持**し、停止は scope の停止で行うのが無難 [推測]

### 再コンパイル（worktree の記事に 1 行追記 → `git checkout` で復元）

| 対象 | 初回コンパイル | 1 行変更後の再コンパイル | 差分が届くまで | 差分サイズ | RSS（起動直後 → 最大） |
|---|---|---|---|---|---|
| 記事単体 | 0.54〜0.58s | 33.5ms | 42ms | 5.9KB | 218MB → 256MB |
| 本全体 | 1.7s | 105ms | 146ms | 4.0KB | 870MB → 1,029MB |

- 再コンパイル時間は tinymist のログ（`compilation succeeded in ...`）、到達時間はファイル書き込みからデータプレーンの次メッセージまで
- コントロールプレーンには `compileStatus`（Compiling → CompileSuccess）と `outline` が届く
- tinymist も `systemd-run --user --scope -p MemoryMax=1200M` の中で起動した（上限内で動作）

## 4. 出力差（PNG、144ppi、記事単体）

| ページ | typst 0.14.2 | tinymist 0.14.18（`tinymist compile`） | 機械比較 |
|---|---|---|---|
| 1 | `<scratchpad>/png/typst-0.14.2-p1.png` | `<scratchpad>/png/tinymist-0.14.18-p1.png` | 画素差 3 / 6,014,496 バイト |
| 3 | `<scratchpad>/png/typst-0.14.2-p3.png` | `<scratchpad>/png/tinymist-0.14.18-p3.png` | ファイル一致 |

- p2 は白紙だったため p3 に差し替えた
- 比べたのは tinymist の**コンパイラ**の出力。プレビュー画面はブラウザ側（typst.ts のレンダラ）で描くため、この環境（ブラウザ無し）では比べられない
- 参考 PDF: `<scratchpad>/out/book-1.pdf`（本全体）、`<scratchpad>/out/art-1.pdf`（記事単体）。scratchpad は再起動で消える

## 補足

- **Noto Sans CJK JP のウェイト**: 候補 7 種をいったん入れて本全体・電子版・記事単体をコンパイルし、PDF に埋め込まれたものを調べた。使われていたのは **Regular と Bold だけ**だったので、この 2 つだけ残した（`NOTO_CJK_WEIGHTS` の既定値）。theme.typ は 900 も指定するが、本文の Rounded Mplus 1c に Black があり、Noto へのフォールバックは起きていない
- **Noto Sans Mono CJK JP が無い**（theme.typ の `mono`）。本全体で警告が 1 件出て、代わりにシステムの IPAGothic が使われている。入れるかは未決
- **Typst パッケージの外部取得**: `articles/author-c/article.typ` が `@preview/tiaoma:0.3.0` を import している。初回コンパイル時に packages.typst.org から取得され、`~/.cache/typst`（約 1MB）に入った
- クローン本体（`repos/<name>/`）は `--no-checkout` で作り、作業ツリーは worktree だけにした（約 105MB 節約）。クローン本体で `git status` を見ると全ファイル削除扱いに見える
- `scripts/setup.sh` の sha256 検証: typst / tinymist は GitHub releases API の `digest` と照合（一致）。フォントは noto-cjk の contents API が返す git blob の sha1 と `git hash-object` で照合（一致）

## ディスク使用量の増分

| 置き場 | 容量 |
|---|---|
| `$TYPST_STUDIO_HOME/bin`（typst 49MB + tinymist 67MB） | 116MB |
| `$TYPST_STUDIO_HOME/fonts`（Noto Sans CJK JP Regular / Bold） | 32MB |
| `$TYPST_STUDIO_HOME/repos/sample-book`（`.git` のみ） | 340MB |
| `$TYPST_STUDIO_HOME/worktrees/sample-book/studio-phase0` | 105MB |
| `~/.cache/typst`（tiaoma パッケージ） | 1MB |
| scratchpad（PDF 2 本・PNG 4 枚・計測ログ） | 67MB |
| **合計** | **約 661MB**（うち scratchpad 67MB は消してよい） |

`df` の使用量は 91,135MB → 91,798MB（+663MB。他プロセスの書き込みを含む）。

## 追記（2026-11-23）

### Noto Sans Mono CJK JP の追加
- `scripts/setup.sh` に Noto Sans Mono CJK JP（Regular / Bold）を追加。取得元は Noto Sans CJK JP と同じ notofonts/noto-cjk `Sans2.004`（`Sans/Mono/`）、照合も同じく contents API の git blob sha（一致）。ウェイトは `NOTO_MONO_CJK_WEIGHTS`（既定 `Regular Bold`）
- 本全体 `main.typ` を `systemd-run --user --scope -p MemoryMax=1200M -p MemorySwapMax=0` でコンパイル: 終了コード 0、4.59s、最大 RSS 979MB
- 警告は 1 件に減った。`unknown font family: noto sans mono cjk jp` は**消えた**。残りは `variable fonts are not currently supported and may render incorrectly`（リポジトリ同梱の可変フォント）× 1
- PDF に埋め込まれたフォントから IPAGothic が消え、NotoSansMonoCJKjp-Regular / Bold が入った
- `$TYPST_STUDIO_HOME/fonts` は 32MB → 64MB

### ディレクトリ構成の変更
- studio はブランチや worktree を管理しない方針にした。プロジェクトごとに通常の clone（checkout あり）を `$TYPST_STUDIO_HOME/projects/<name>/` に置き、git 操作は人か Claude がコマンドで行う
- `scripts/clone-repo.sh` を廃止し、`scripts/add-project.sh <name> <git-url>` に置き換えた（既にあればスキップ）
- 既存の `repos/sample-book`（`--no-checkout`）と `worktrees/sample-book/studio-phase0` は移行した。worktree に未コミットの変更・無視ファイルは無く、`git log origin/main..studio/phase0` も空だったので、worktree を `git worktree remove` で外し、`studio/phase0` を削除し、クローンを `projects/sample-book` に移して mainを checkout した（再クローンなし）。`repos/` `worktrees/` は削除
- 容量: `repos` 340MB + `worktrees` 105MB → `projects/sample-book` 444MB（ほぼ同じ）
