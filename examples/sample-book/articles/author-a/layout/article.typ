#import "/template.typ": article-title

#article-title[絶対値で大きさを決める][著者 A（架空）]

割合ではなく、長さそのもので大きさを決めることもできます。紙の版と電子版で本文の幅が違っても、同じ大きさで置きたいときに使います。

== 幅を mm で書く

`width: 32mm` は、本文の幅に関係なく 32mm になります。

#figure(
  image("images/landscape-4x3.png", width: 32mm),
  caption: [4:3 の画像（幅 32mm）],
)

== 高さを文字の大きさで書く

`height: 8em` は文字の大きさの 8 倍の高さです。縦長の画像は、幅より高さで決めたほうが紙面で扱いやすくなります。

#figure(
  image("images/portrait-3x4.png", height: 8em),
  caption: [3:4 の画像（高さ 8em）],
)

== 横に並べる

二つの画像を同じ幅で並べると、比率の違いが分かります。

#grid(
  columns: (1fr, 1fr),
  gutter: 8mm,
  figure(image("images/landscape-4x3.png", width: 100%), caption: [4:3]),
  figure(image("images/portrait-3x4.png", width: 100%), caption: [3:4]),
)
