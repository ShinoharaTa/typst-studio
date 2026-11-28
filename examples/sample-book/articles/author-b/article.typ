#import "/template.typ": article-title, category-label

#article-title[コラム: パスを変数で渡す][著者 B（架空）]

#category-label(default: "column")

画像のパスを変数に入れてから渡すこともできます。この形はソースを実行しないとパスが決まらないので、typst-studio の画像サイズ指定 UI では「編集不可」として一覧に出ます。

#let icon-path = "images/icon-1x1.png"

#figure(
  image(icon-path, width: 16mm),
  caption: [256 × 256 のアイコン（パスは変数）],
)

== 拾われない書き方

次の行はコメントの中なので、画像として扱われません。

// 以前は image("images/old-icon.png", width: 50%) と書いていた

文字列の中に書いたものも、画像ではなくただの文字です。

#let snippet = "image(\"images/icon-1x1.png\", width: 50%)"

#raw(snippet, lang: "typ", block: true)

== 小さな画像を本文に混ぜる

アイコンのような小さな画像は、本文の行の中に置けます。#box(image(icon-path, height: 1em), baseline: 15%) このように、文字と同じ高さにそろえます。
