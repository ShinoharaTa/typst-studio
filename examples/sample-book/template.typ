// 本と記事プレビューで共通の体裁
// sys.inputs: EBOOK = "true" で電子版（余白を左右対称にし、リンクに色を付ける）

#let is-ebook = sys.inputs.at("EBOOK", default: "false") == "true"

#let book(title: none, body) = {
  set document(title: title)
  set page(
    paper: "jis-b5",
    margin: if is-ebook { (x: 18mm, y: 20mm) } else { (inside: 22mm, outside: 16mm, y: 20mm) },
    numbering: "1",
  )
  set text(font: "Noto Sans CJK JP", size: 10pt, lang: "ja")
  show raw: set text(font: "Noto Sans Mono CJK JP")
  set par(justify: true, leading: 0.9em, first-line-indent: (amount: 1em, all: true))
  set heading(numbering: "1.1")
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    block(below: 1.5em, text(size: 18pt, it))
  }
  show link: it => if is-ebook { text(fill: blue.darken(20%), it) } else { it }
  set figure(gap: 0.8em)
  body
}

// 記事の見出しと著者名
#let article-title(title, author) = {
  heading(level: 1, title)
  if author != none {
    align(right, text(size: 9pt, fill: luma(40%), author))
  }
}

// 記事の分類（記事単体プレビューでは sys.inputs の CATEGORY を使う）
#let category-label(default: none) = {
  let c = sys.inputs.at("CATEGORY", default: default)
  if c != none { box(inset: (x: 4pt, y: 2pt), stroke: 0.5pt + luma(50%), radius: 2pt, text(size: 8pt, c)) }
}
