// プレースホルダー画像（gen-images.sh から --ppi 72 で呼ぶ。1pt = 1px になる）
// sys.inputs: W, H（px）、RATIO（表示用の比率）、HUE（0-360）
#let w = int(sys.inputs.at("W", default: "1200"))
#let h = int(sys.inputs.at("H", default: "1200"))
#let ratio = sys.inputs.at("RATIO", default: "1:1")
#let hue = float(sys.inputs.at("HUE", default: "210")) * 1deg

#let short = calc.min(w, h)
#let bg = color.oklch(96%, 0.03, hue)
#let minor = color.oklch(85%, 0.05, hue)
#let major = color.oklch(70%, 0.09, hue)
#let ink = color.oklch(35%, 0.12, hue)
#let accent = color.oklch(60%, 0.2, calc.rem(hue / 1deg + 180, 360) * 1deg)

// 格子の間隔: 短辺が小さい画像では細かくしすぎない
#let step = if short < 400 { 32 } else { 100 }

#set page(width: w * 1pt, height: h * 1pt, margin: 0pt, fill: bg)
#set text(font: "Noto Sans CJK JP", fill: ink)

#let vline(x, stroke) = place(top + left, line(start: (x * 1pt, 0pt), end: (x * 1pt, h * 1pt), stroke: stroke))
#let hline(y, stroke) = place(top + left, line(start: (0pt, y * 1pt), end: (w * 1pt, y * 1pt), stroke: stroke))

// 格子（step px ごと。5 本ごとに濃く）。1px の線は 0.5px ずらして画素に合わせる（ぼけると PNG が重くなる）
#for i in range(1, calc.ceil(w / step)) {
  if calc.rem(i, 5) == 0 { vline(i * step, 2pt + major) } else { vline(i * step + 0.5, 1pt + minor) }
}
#for i in range(1, calc.ceil(h / step)) {
  if calc.rem(i, 5) == 0 { hline(i * step, 2pt + major) } else { hline(i * step + 0.5, 1pt + minor) }
}

// 中心線と外枠
#let center-stroke = (paint: accent, thickness: calc.max(2, calc.round(short / 400) * 2) * 1pt, dash: (array: (24pt, 12pt)))
#vline(calc.floor(w / 2), center-stroke)
#hline(calc.floor(h / 2), center-stroke)
#place(top + left, rect(width: 100%, height: 100%, stroke: (calc.max(4, calc.round(short / 120) * 2) * 1pt) + ink))

// 比率とピクセル数
#place(center + horizon, box(
  fill: bg.transparentize(10%),
  inset: short * 0.04pt,
  radius: short * 0.02pt,
  stack(
    dir: ttb,
    spacing: short * 0.04pt,
    align(center, text(size: short * 0.24pt, weight: "bold", ratio)),
    align(center, text(size: short * 0.09pt, [#w × #h px])),
  ),
))
