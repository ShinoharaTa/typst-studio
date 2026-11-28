// 記事単体のプレビュー
// sys.inputs: ARTICLE = 記事のパス（本のルート相対。例 "articles/author-b/article.typ"）、CATEGORY（任意）
#import "template.typ": book

#let article = sys.inputs.at("ARTICLE", default: "articles/author-a/intro/article.typ")

#show: book.with(title: "プレビュー")

#include "/" + article.trim("/", at: start)
