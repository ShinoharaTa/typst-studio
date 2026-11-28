# デザインシステム

web（`web/src`）の見た目の作りと、部品の使い分けの規則。画面を足す・直すときはここを先に読む。
規則のうち ✓ を付けたものは `web/src/styles.node.test.ts` で検査する（付いていないものは検査で止まらないので、レビューで見る）。

## 選んだもの

**shadcn/ui の Base UI 版の作り方 + Tailwind CSS v4**（tailwindcss / @tailwindcss/vite 4.3.5、class-variance-authority 0.7.1、clsx 2.1.1、tailwind-merge 3.7.0）。
shadcn の CLI は使わず、shadcn の構成（`components/ui/*`、`cn()`、cva の variant、`data-slot`、意味の名前のトークン）に沿って手で書く。
部品の土台は `@base-ui/react`（AlertDialog・Drawer）。アイコンは lucide-react 1.72.0。

理由:
- 土台が同じ Base UI なので、ダイアログ・シートの挙動（フォーカス・スワイプ）を変えずに見た目だけ揃えられる。
  ほかの候補（Radix Themes・Mantine・Park UI / Ark UI・Panda CSS のみ）は、部品の土台を二重に持つか、全部を置き換えることになる。
- Tailwind v4 は使ったクラスだけを出す。トークンは `@theme` に一元化し、既定の色・影・角丸・文字の大きさを消して（`--color-*: initial` など）、トークン以外を書けなくする。
- 部品のコードを自分で持つので、「線を使わず面と余白で表す」を部品の側で守れる（shadcn の既定の border / ring は入れない）。
- CodeMirror と sonner は自分の CSS を `@layer` の外に入れる。Tailwind は `@layer` の中なので、上書きの順序が崩れない。CodeMirror の上書きは `@layer` の外の別ファイル（`styles/codemirror.css`）。

## ファイルの置き場

| ファイル | 中身 |
|---|---|
| `web/src/styles.css` | トークン（`:root` とダーク）、`@theme`、面の段（`surface-*`・`box-inside`） |
| `web/src/styles/screen.css` | 画面の骨組み（2 ペインのグリッド・入れ替え・キーボード表示中の段・safe-area・トーストの位置）。data 属性の組み合わせが多いので CSS で書く |
| `web/src/styles/codemirror.css` | CodeMirror の上書き |
| `web/src/components/ui/*` | 部品（見た目を持つのはここだけ） |

- トークンの名前は shadcn に合わせる: background / foreground / card / secondary / popover / muted-foreground / primary / accent / destructive / ring。
  足りないものを足す: secondary-press、popover-box / popover-press、destructive-soft / destructive-press、warning(-soft)、success、tab-track / tab-on / tab-press、pdf / paper、hl-*。
  色はライト・ダークともコントラストを測って決め、検査で下限を保つ ✓。
- テストが使う名前（`.tab` `.tb-save` `.view-tabs` など）は、見た目を持たない目印として残す。

## 使い分けの規則

### 文字の役割（4 段 + 入力）✓

| 名前 | 大きさ | 使う所 |
|---|---|---|
| `text-screen` | 20px / 600 | 画面の題（どの画面でも同じ） |
| `text-title` | 17px / 600 | 重なる面の題（シート・ダイアログ） |
| `text-body` | 15px | 本文・ボタン（md）・タブ・行の題（600）・キー・トーストの文 |
| `text-caption` | 13px | 補助・行の説明・バッジ・ラベル・グループの見出し（600・muted）・状態・ボタン（sm）・行番号 |
| `text-input` | 16px | 入力欄とエディタだけ（iOS の拡大を避ける）。ほかの用途に使わない |

- 序列は screen > title > body > caption（行の題が画面の題より大きくならない）✓。見出しの太さは semibold（600）だけで、`font-bold` は使わない ✓。
- CSS の `font-size` もトークン（`var(--text-*)`）だけで書く ✓。
- 等幅（`font-mono`）は中身がコード・パスのときだけ付けてよい。

### 面の段と角丸 ✓

| 段 | 地 | 角丸 | 例 |
|---|---|---|---|
| L0 背景 | background | — | 画面・ヘッダ |
| L1 面 | card | panel 16 | ペイン（2 ペイン時）・PanelBar・ツールバー |
| L2 箱 | 置かれた面が配る `bg-box` | box 10 | ボタン・入力・一覧の行・通知・キー・サムネ・PDF の台 |
| F 浮く面 | popover（その上の箱は popover-box） | float 20 | トースト・シート・ダイアログ・診断の帯（チップだけ pill） |
| — | — | pill | タブ・セグメント・バッジ・チップ |

- 箱の地は呼ぶ側が選ばない。面（`surface-background` / `surface-card` / `surface-popover`、`:root` は背景と同じ）が `--box` / `--box-press` / `--box-2` を配り、部品は `bg-box` を使う。
- 箱の中に置くもの（行の中身・通知の中身）は `box-inside` で 1 段上（`--box-2`）になる。**`box-inside` は 2 段まで**（面 → 箱 → 箱の中の箱）。`--box-2` の先は無いので、箱の中の箱にさらに箱を置かない。
- ライトの浮く面はパネルより少し沈んだ色（iOS のシートと同じ考え）、ダークはパネルより明るい色 ✓。影は補助で、外さない。

### 余白 ✓

- 4 / 8 / 12 / 16 / 24 / 32 の 6 値。行内だけ 2、当たり判定に合わせる 44。検査するのは padding・margin・gap（inset・大きさ・translate は対象外）。
- 画面の外周（ヘッダ・2 ペインの隙間）は 8、ペインの内側は 12、行の内側は 12。
- 一覧の画面の左端: 行の文字・グループの見出しは 24（行の 12 + 行の内側 12）。題も 24 に揃えるのは「‹」の無い画面（プロジェクト一覧）だけ。「‹」のある画面（記事一覧・編集）の題は「‹」の右に置く。
- 一覧の画面は最大幅 640px で中央に置く（ヘッダも同じ幅）。
- 任意の値（`text-[14px]`・`rounded-[2px]`・`p-[3px]`）は文字・角丸・色・影・余白に使わない ✓（safe-area の calc は除く。大きさ・最大の高さ・グリッドの列は任意の値でよい）。

### `className` の使い方 ✓

- 部品（`components/ui` の大文字の要素）に `className` で文字の大きさ・太さ・内側の余白（padding）を上書きしない ✓。渡してよいのは置き場所（margin・position・flex・幅・最大の高さ）・`font-mono`・目印。
  変えたいときは部品に variant か prop を足す（例: キーボード表示中のタブの文字は `TabsTrigger` の `kbCompact`）。
- `components/ui` の外では、地・角丸・影・面（`bg-*` / `rounded-*` / `shadow-*` / `surface-*`）、任意のプロパティ（`[background:…]`）、`style` 属性での地・角丸・影・文字・余白を書かない ✓。
- 画面の側の素の要素（`span` / `p` / `button` など、部品でないもの）には、文字の役割（`text-caption` など）と `font-semibold` を書いてよい。
  ただし同じ構成が部品にあるとき（サムネ + 題 + 説明 = 一覧の行）は部品を使う。
- 検査はコメントを除いた文字列リテラル（className・定数・`cn()`・`cva()`・テンプレート文字列）を見る。Tailwind はテストのファイルを読まない（`@source not`）。

### ボタン

| | md（44） | sm（36、当たりは ::after で 44） |
|---|---|---|
| primary（塗り） | 画面の主の操作 1 つ（ビルド・適用・挿入） | — |
| secondary（箱） | 通常の操作（取り消し・アップロード）・EmptyState と Alert の中の操作 | — |
| ghost（地なし） | 戻る「‹」・ソースへ | 拡大縮小・ダウンロード・入れ替え・行の「↵ 12 行」 |
| destructive | 取り返しのつかない操作（上書き） | — |

- primary は 1 画面に 1 つ。EmptyState・Alert の中の操作は secondary にする（同じ画面の段に主の操作があるので、2 つ目の塗りにしない）。
  例外は、その通知の操作が画面で唯一の主の操作のとき（画像のアップロード後の「カーソル位置に挿入」）。
- 形は角丸 box の 1 種。ピルにしない（ピルはタブ・バッジ・チップ）。アイコンだけのときは `icon`（正方形）。
- 文字だけのボタンが表示と見分けにくいとき（行の行番号）は、アイコンを前に置いて押せると分かるようにする。
- 無効は塗りをやめ（primary）、文字を muted にする。sm を並べるときは 8px 以上空ける（当たりが重ならない）。

### 状態の見せ方

- 空・読み込み中: `EmptyState`（中央の文 + 補足 `description` + 次の操作 1 つ）。この画面に次の操作が無いときは、どこで何をすればよいかを `description` に書く（プロジェクト 0 件）。PDF・プレビューの台の上では台の中央（`fill`）。
- エラー・注意の箱: `Alert`（default / destructive × md / sm）。中の操作は 1 つ、文の下に置く。一覧の行の中では `as="span"`。文字だけのエラーは `FieldError`（入力欄の下）に限る。
- 一時的な結果: トースト。編集画面ではヘッダとタブの段の下に出す（キーボード表示中も「‹」とタブの段を覆わない）。
  **位置はヘッダの高さが一定であることが前提**（`styles/screen.css` の `--toast-top` に内訳）。ヘッダの題と題の下の行は折り返さず、長いもの（ブランチ名・記事名）はバッジの中で省略する ✓。ヘッダに段や行を足すときは `--toast-top` も直す。
- 保存の状態: ツールバーの「保存」の文言と地（quiet / accent / destructive）。ヘッダは衝突・失敗のときだけバッジ。
- 選択中: track の上の明るいピル + primary の文字（ホバー・押下で選択の色を失わない）。
- 例・補足は placeholder に書かず、欄の下の `FieldDescription` に書く。ラベルの外に置き、`aria-describedby` で欄に結びつける（欄の名前に混ぜない）。

### 一覧の行

- 1 部品（`ListItem*`）。構成は 先頭（`ListItemMedia`: サムネ）・本文（`ListItemContent`: Eyebrow → Title → Description）・末尾（`ListItemActions`）。
- 行全体が 1 操作なら `ListItemLink` / `ListItemButton`、本体と末尾を別々に押すなら `ListItemSplit`（ボタンを入れ子にしない）。
- `ListItemContent` は `span`（ボタンの中に置けるように）。中に置くものも `span` にする（`Alert` は `as="span"`）。
- 行間は 8。高さは最小 52。

### 操作の並べ方

- 段（`PanelBar`）: 左に状態・選択、右に操作。主の操作（primary）は段の右端。段どうしの間は 8（前に段・Alert・Disclosure があれば上の余白を詰める）。
  詰めるかどうかは兄弟の要素で決まるので、段の並びに `display: contents` の要素を挟まない（Fragment で並べる）。
  中身が無いときに意味の無い段は出さない（PDF が無いときのページ番号・拡大縮小）。
- シート・ダイアログの末尾: 右寄せで、主の操作（primary / destructive）を右端に置く。補助（ソースへ）は左端に ghost で置く。
- **シートの操作の段は `SheetFooter` で下端に固定する**（sticky・浮く面の地・下の safe-area）。シートは下へのスワイプで閉じるので、主の操作を探してスクロールさせない。`SheetFooter` は `SheetContent` の直下に置く。
- 折り返したら各行を全幅にする。ダイアログは開いた直後にボタンへフォーカスを当てない（どちらも内容を捨てるとき）。

### 選ぶ部品（Tabs と Segment）

- 作りは 1 つ（トラック + 選択中のピル）。表示（面）の切り替えは `TabsList` / `TabsTrigger`（nav、URL が変わる）、フォームの中の値の選択は `SegmentGroup` / `SegmentItem`（role=group）。

### アイコン ✓

- lucide-react の名前付き import だけ ✓。文字の記号（‹ ↶ ⇄ ▶ − ＋ ×）で代用しない ✓。
- 大きさは置き場が決める: ボタン md 20 / sm 16、行内（見出しの前）12〜16。読み上げは親の `aria-label` で（アイコンは aria-hidden）。
- 使っているもの: ChevronLeft・ChevronRight・Undo2・ArrowLeftRight・Play・Minus・Plus・X・ImageOff・Download・Upload・CornerDownLeft・CircleAlert・TriangleAlert。

### 線 ✓

- 線は使わない（border・divide・ring のユーティリティも、CSS の border も）✓。残すのはフォーカスと入力エラーの outline、エディタのカーソルだけ。
- CodeMirror の lint の吹き出しの枠と診断の左の太線も消す ✓。

## 画面の骨組み

### 幅

| 幅 | 作り |
|---|---|
| 900px 未満 | 1 ペイン。ペインを重ねて置き、見えないものは visibility で隠す。タブはヘッダの 2 段目 |
| 900px 以上 | 2 ペイン（左: 編集、右: プレビュー / 本 / 画像。入れ替えられる）。ヘッダもペインと同じ 2 列 |
| 一覧の画面 | 幅によらず最大 640px で中央 |

### 重なりの順（z-index）

| 値 | もの | 置き場 |
|---|---|---|
| 1 | 2 ペインの「入れ替え」（隣の列より上で押せるように）・画像タブのアップロードの段（sticky）・シートの操作の段（sticky） | `screen.css` `.swap-btn`、`ImagesPane.tsx`、`ui/sheet.tsx` |
| 2 | エディタの下端のフェード | `screen.css` `.editor-wrap::after` |
| 3 | 行の診断の帯 | `EditorScreen.tsx` `.line-diag` |
| 5 | 「ソースへ」チップ | `screen.css` `.chip-wrap` |
| 20 | シート | `screen.css` `.sheet-viewport` |
| 30 / 31 | ダイアログの幕 / ダイアログ | `ui/alert-dialog.tsx` |
| sonner の既定 | トースト（いちばん上） | sonner の CSS |

新しく重ねるものは、この表のどこに入るかを決めてから値を選び、表に足す。
