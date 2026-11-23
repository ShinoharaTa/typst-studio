# Phase 1 最初の切片: tinymist preview の中継の検証結果

- 計測日: 2026-11-23
- 環境: N100 / 空きメモリ約 2.6GB、swap 満杯 / Ubuntu 24.04 / Node v24.20.0
- 対象: `$TYPST_STUDIO_HOME/projects/sample-book`、記事 `articles/author-a/article.typ`（phase0 と同じ）
- tinymist 0.14.18。`systemd-scope` ドライバ経由（`MemoryMax=600M` / `MemorySwapMax=0` / `CPUQuota=200%` / nice 10）
- プロジェクト設定は仮の置き場 `$TYPST_STUDIO_HOME/project-overrides/sample-book.toml`（リポジトリには置いていない）

## 結論

**中継越しに使える。** tailnet を模した `Origin: https://example.ts.net` で studio の `/` に繋ぐと、Origin を `http://127.0.0.1:23625` に付け替えて tinymist に渡り、初回データ・差分とも届いた。同じ Origin で tinymist に直接繋ぐと切断される。
スマホ実機・iframe 内・`editorScrollTo` は未確認（この環境にブラウザが無い）。

## 結果

| # | 項目 | 結果 |
|---|---|---|
| a | `GET /preview/` | **200**、1,647,695 バイト（直接取得と同じ）、`text/html`、11〜15ms |
| b | 中継越しの WebSocket（`Origin: https://example.ts.net` → `ws://127.0.0.1:8796/`、接続後に `current` を送信） | 接続 12.6ms、初回データ到着 **111.5ms**（接続開始から）、**10,315,476 バイト**（1 メッセージ） |
| b' | 比較: 同じ Origin で `ws://127.0.0.1:23625/` に直接 | 8.4ms で切断（`socket hang up`） |
| c | 記事に 1 行追記 → 中継越しの差分 | 書き込みから **46.4ms** で差分 **3,956 バイト** が届いた。tinymist のログは `compilation succeeded in 29.99ms`。`git checkout` で戻し、`git status` はクリーン |
| d | 中継接続の切断・再接続 | 順に 5 回 + 同時 2 本を繋いで切った。初回データは毎回 78〜161ms・約 10.32MB。tinymist は同じ PID のまま、制御接続は `connected: true` のまま、閲覧者数は 0 に戻った |
| e | `POST /api/preview/stop` | 応答 83ms。終了理由 `stopped`（SIGTERM、scope result `success`）。23625 / 23626 は解放、`typst-studio-*` の unit は残らない。停止後の `/preview/` は 503 |
| f | RSS | tinymist **299,940kB**（VmHWM 同値。接続 9 回 + 編集 1 回の後）、scope の MemoryCurrent 321.7MB / MemoryPeak 326.2MB。studio（node）**104,320kB**（VmHWM 同値） |

### 追加で確かめたこと

| 項目 | 結果 |
|---|---|
| scope の上限 | `MemoryMax=629145600`（600M）、`MemorySwapMax=0`、`CPUQuotaPerSecUSec=2s`、tinymist の NI = 10 |
| アイドル停止 | `idle_stop_minutes = 0.1` にした別の `TYPST_STUDIO_HOME` で、最後の閲覧者が切れてから **6.0 秒**で停止（制御接続は切らずにドライバの停止を呼び、その後に制御接続が閉じた） |
| 記事の切り替え | 2 回目の `start` で既存の tinymist を止めて起動し直す。`articles/author-b/article.typ` では `[[articles.override]]` の `CATEGORY=example` も渡った。初回データ 18,077,316 バイト / 393.5ms |
| 終了理由 `limit` | `memory_max = "120M"` で起動 → 閲覧者が繋いだ時点で OOM kill。`lastExit` は `reason: "limit"`、SIGKILL、scope result `oom-kill`。studio は動き続け（`/healthz` 200）、failed の scope は `reset-failed` で消えた |
| `/api/ws` への upgrade | 404（今回は作っていない） |
| 制御プレーンのメッセージ | `syncEditorChanges` 1、`compileStatus` 6、`outline` 59（閲覧者が繋ぐたびに `outline` が来る）。直近 1 件は `/api/preview/status` の `control.last` |

### 気づいたこと

- tinymist はクライアントからの close フレームに応答しない（直接でも中継でも close code 1006）。中継の動作には影響なし
- 初回データのサイズは同じ記事でも数十〜3KB ほど揺れる（10,315,444〜10,318,540 バイト）
- 記事単体の RSS は phase0 の 256MB より大きい 300MB（接続を繰り返した後）。上限 600M には余裕がある
- 中継はフレームを解かずにバイトをそのまま流している（10MB のメッセージを node で組み立て直さない）

## 未確認（この環境では確認できない）

- スマホ実機での表示、iframe 内での動作
- `editorScrollTo` がタップで届くか（Phase 0.5 #5）
- `tailscale serve` の HTTPS（`wss:`）越しの実際の経路

## 再現手順

計測に使ったスクリプトは scratchpad（`wsprobe.mjs`: 指定 Origin で接続 → `current` を送信 → 初回データと、任意で記事追記後の差分を計測）。scratchpad は再起動で消える。
