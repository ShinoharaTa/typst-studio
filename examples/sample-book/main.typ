// 本全体。sys.inputs の EBOOK = "true" で電子版
#import "template.typ": book, is-ebook

#show: book.with(title: "架空の手引き書（サンプル）")

#align(center + horizon)[
  #text(size: 24pt, weight: "bold")[架空の手引き書]

  #text(size: 12pt)[typst-studio のサンプルの本]

  #v(2em)
  #text(size: 10pt)[#if is-ebook [電子版] else [印刷版]]
]

#pagebreak()
#outline(depth: 1)

#include "articles/author-a/intro/article.typ"
#include "articles/author-a/layout/article.typ"
#include "articles/author-b/article.typ"
