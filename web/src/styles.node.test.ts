// @vitest-environment jsdom
// デザインシステムの検査: トークン（styles.css の :root）のコントラスト、線を使わない取り決め、
// 画面の骨組み（styles/screen.css）と CodeMirror の上書き（styles/codemirror.css）、部品のクラス（components の .tsx）。
// （vitest は CSS の import を空にするので、ファイルを直接読む。型は tsconfig.node-test.json で検査する）
// 制約: jsdom の getComputedStyle は詳細度を見ない（後に書いた規則が勝つ）。Tailwind のユーティリティも作られない。
//   規則どうしの勝ち負けはここでは確かめられないので、セレクタやクラスの形を正規表現で確かめ、実際の見え方は Chromium で確かめる
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, p), "utf8");
const css = read("styles.css");
const screen = read("styles/screen.css");
const cm = read("styles/codemirror.css");
const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const light = css.slice(0, darkStart);
const dark = css.slice(darkStart, css.indexOf("\n}\n", darkStart));

// 画面と部品のソース（テストを除く）。ui/ の中が部品、外が画面
const sources = (() => {
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(import.meta.dirname, dir), { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name) && !/\.test\./.test(e.name)) out.push([p, read(p)]);
    }
  };
  walk("components");
  out.push(["App.tsx", read("App.tsx")]);
  return out;
})();

// コメントを外す（説明に書いたクラス名を、使っている・使ってはいけないものと数えない）。
// 文字列の中の // （URL など）は、直前が : か引用符なら残す
const stripComments = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

// 文字列リテラル（"…" '…' `…`）の中身。テンプレートの ${…} は空白にし、その中の式の文字列も拾う。
// className に直接書いたものも、定数・cn()・cva() に置いたものも同じに拾う
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(src).matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    if (m[3] === undefined) out.push(m[1] ?? m[2]);
    else {
      out.push(m[3].replace(/\$\{[^}]*\}/g, " "));
      for (const e of m[3].matchAll(/\$\{([^}]*)\}/g)) out.push(...stringLiterals(e[1]));
    }
  }
  return out;
}

// クラス名の本体（hover: などの variant、! の重要度、- の符号を外したもの）。任意のプロパティ（[background:red]）はそのまま返す
function utility(cls: string): string {
  // 角括弧の外にある最後の : の後ろ
  let depth = 0;
  let last = -1;
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] === "[") depth++;
    else if (cls[i] === "]") depth--;
    else if (cls[i] === ":" && depth === 0) last = i;
  }
  return cls
    .slice(last + 1)
    .replace(/^!|!$/g, "")
    .replace(/^-/, "");
}
const classTokens = (src: string) => stringLiterals(src).flatMap((l) => l.split(/\s+/).filter(Boolean));

// JSX の部品（大文字で始まる要素）に渡した className の文字列
function componentClassNames(src: string): { tag: string; classes: string[] }[] {
  const code = stripComments(src);
  const out: { tag: string; classes: string[] }[] = [];
  for (const m of code.matchAll(/<([A-Z][\w.]*)\b/g)) {
    // タグの終わり（波括弧と文字列の外の >）まで
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < code.length; i++) {
      const c = code[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const attrs = code.slice(m.index, i);
    const at = attrs.search(/\sclassName=/);
    if (at < 0) continue;
    // className= の値（"…" か {…}）
    let j = attrs.indexOf("=", at) + 1;
    let end = j;
    if (attrs[j] === '"') end = attrs.indexOf('"', j + 1) + 1;
    else {
      let d = 0;
      for (; end < attrs.length; end++) {
        if (attrs[end] === "{") d++;
        else if (attrs[end] === "}" && --d === 0) break;
      }
      end++;
    }
    out.push({ tag: m[1], classes: stringLiterals(attrs.slice(j, end)).flatMap((l) => l.split(/\s+/).filter(Boolean)) });
  }
  return out;
}

const token = (block: string, name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  if (!m) throw new Error(`--${name} not found`);
  return m[1];
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const rule = (text: string, sel: string) => new RegExp(`\\n${sel.replace(/[.[\]()]/g, "\\$&")} \\{([^}]*)\\}`).exec(text)?.[1] ?? "";

describe("design tokens (styles.css)", () => {
  it("keeps the comment color at 4.5:1 or more on the editor panel, in light and dark", () => {
    for (const block of [light, dark]) {
      expect(contrast(token(block, "hl-comment"), token(block, "card"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps muted text and the accent readable on every surface they sit on", () => {
    for (const block of [light, dark]) {
      expect(contrast(token(block, "foreground"), token(block, "background"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "muted-foreground"), token(block, "card"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "muted-foreground"), token(block, "secondary-press"))).toBeGreaterThanOrEqual(4.5);
      // 未保存の「保存」・選んだ単位・「前回」: accent の地に primary の文字
      expect(contrast(token(block, "primary"), token(block, "accent"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "primary-foreground"), token(block, "primary"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "destructive"), token(block, "destructive-soft"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "warning"), token(block, "warning-soft"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("sets the floating surfaces (popover) apart from the panel and the background in light and dark, and keeps text readable on them", () => {
    for (const block of [light, dark]) {
      // 浮く面は、載る先（パネル・背景）と色で分かれる（影だけに頼らない）
      expect(contrast(token(block, "popover"), token(block, "card"))).toBeGreaterThanOrEqual(1.08);
      expect(contrast(token(block, "popover"), token(block, "background"))).toBeGreaterThanOrEqual(1.08);
      expect(contrast(token(block, "popover-box"), token(block, "popover"))).toBeGreaterThanOrEqual(1.08);
      for (const bg of ["popover", "popover-box"]) {
        expect(contrast(token(block, "foreground"), token(block, bg)), bg).toBeGreaterThanOrEqual(4.5);
        expect(contrast(token(block, "muted-foreground"), token(block, bg)), bg).toBeGreaterThanOrEqual(4.5);
      }
      for (const fg of ["primary", "destructive", "warning"]) expect(contrast(token(block, fg), token(block, "popover")), fg).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "destructive"), token(block, "destructive-press"))).toBeGreaterThanOrEqual(4.5);
    }
    // ダークで浮く面がパネルと同じ色にならない（以前は両方 card で境目が消えた）
    expect(token(dark, "popover")).not.toBe(token(dark, "card"));
  });

  it("sets the tabs apart on a track: the selected pill stands out in light and dark, and the labels stay readable", () => {
    for (const block of [light, dark]) {
      expect(contrast(token(block, "tab-on"), token(block, "tab-track"))).toBeGreaterThanOrEqual(1.3);
      expect(contrast(token(block, "primary"), token(block, "tab-on"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "muted-foreground"), token(block, "tab-track"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "muted-foreground"), token(block, "tab-press"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("removes Tailwind's default palette, so only the tokens can be used", () => {
    expect(css).toMatch(/@theme \{\s*--color-\*: initial;/);
    expect(css).toContain("--spacing: 4px;");
    expect(css).toContain("@custom-variant kb (:root[data-kb] &);");
    // ホバーはマウスなどの細かい指し示しがある端末だけ（タッチで押した後に色が残らないように）
    expect(css).toMatch(/@custom-variant hover \{\s*@media \(hover: hover\) and \(pointer: fine\)/);
  });

  it("has 4 text roles + the input size, 3 radii + pill, and no unused colors", () => {
    const theme = css.slice(css.indexOf("@theme {"), css.indexOf("@theme inline"));
    expect([...theme.matchAll(/--text-([a-z]+):/g)].map((m) => m[1])).toEqual(["caption", "body", "title", "screen", "input"]);
    expect([...theme.matchAll(/--radius-([a-z]+):/g)].map((m) => m[1])).toEqual(["box", "panel", "float", "pill"]);
    // 序列: 画面の題 > 重なる面の題 > 入力 > 本文 > 補助
    const px = (n: string) => Number(new RegExp(`--text-${n}: (\\d+)px`).exec(theme)![1]);
    expect(px("screen")).toBeGreaterThan(px("title"));
    expect(px("title")).toBeGreaterThan(px("body"));
    expect(px("body")).toBeGreaterThan(px("caption"));
    // @theme inline の色は、どれもどこかで使う（bg-x / text-x / fill-x などのユーティリティ。コメントの中の語は数えない）
    const inline = css.slice(css.indexOf("@theme inline"));
    const used = new Set(sources.flatMap(([, src]) => classTokens(src)).map((c) => utility(c).replace(/\/\d+$/, "")));
    const unused = [...inline.matchAll(/--color-([a-z0-9-]+):/g)]
      .map((m) => m[1])
      .filter((name) => !["bg", "text", "fill", "stroke", "outline", "accent", "caret"].some((u) => used.has(`${u}-${name}`)));
    expect(unused).toEqual([]);
  });
});

describe("no lines", () => {
  it("draws no borders in the CSS (only border: 0, radius and the cursor)", () => {
    for (const text of [css, screen, cm]) {
      const bad = text.split("\n").filter((l) => /border/.test(l) && !/border: 0|border-radius|border-left-color/.test(l));
      expect(bad).toEqual([]);
    }
  });

  it("uses no border, divide or ring utilities in the components, and no colors outside the tokens", () => {
    for (const [file, src] of sources) {
      // border-0! は sonner の閉じるボタンの線を消すためのもの
      const lines = src.match(/(?<![\w-])(border(-[trblxyse])?(-\d+)?|divide-[xy](-\d+)?|ring(-\d+)?|ring-offset-\d+)(?=[\s"'`])/g) ?? [];
      expect(lines, file).toEqual([]);
      expect(src, file).not.toMatch(/(bg|text|outline|shadow|fill|stroke)-\[(#|rgb|hsl|oklch)/);
    }
  });
});

describe("screen layout (styles/screen.css)", () => {
  it("reserves the room for the swap button with margins, so the neighbouring header columns never cover it", () => {
    const rules = [...screen.matchAll(/\n(\.editor-screen\[data-wide="true"\][^{]*(?:\.topbar-main|\.topbar \.view-tabs)) \{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const [, sel, body] of rules) expect(body, sel).not.toMatch(/padding/);
    expect(rule(screen, ".swap-btn")).toContain("z-index: 1;");
  });

  it("keeps the editor header at a fixed height, so the toast offset (--toast-top) never covers the tabs", () => {
    // 題も題の下の行も折り返さない（長いブランチ名は GitBadge の compact で省略する）
    expect(rule(screen, ".topbar-title")).toContain("white-space: nowrap;");
    expect(rule(screen, ".topbar-sub")).toContain("flex-wrap: nowrap;");
    expect(rule(screen, ".topbar-sub")).toMatch(/min-height: /);
    expect(read("components/GitBadge.tsx")).toMatch(/compact \? "flex-nowrap" : "flex-wrap"/);
    // 内訳はコメントに書いた値（ヘッダ 113 / キーボード表示中 52 / 2 ペイン 57、+ 8）
    expect(screen).toContain("+ 113px + 8px");
    expect(screen).toContain("+ 52px + 8px");
    expect(screen).toContain("+ 57px + 8px");
  });

  it("puts the editor and the toolbar on the same panel", () => {
    expect(rule(screen, ".pane-edit")).toContain("@apply surface-card");
    expect(rule(screen, ".editor-wrap")).toContain("@apply surface-card");
    expect(read("components/ui/toolbar.tsx")).toContain('"surface-card flex');
  });

  it("never hides the view tabs, and shrinks their labels to caption while the keyboard is shown", () => {
    // display を決めるのは TabsList の flex（ユーティリティ）。骨組みの CSS では .view-tabs と .tab の display を変えない
    for (const m of screen.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
      if (/\.view-tabs|\.tab\b/.test(m[1])) expect(m[2], m[1]).not.toMatch(/display:/);
    }
    // タブの文字を caption にするのは TabsTrigger の kbCompact（描画した結果は EditorScreen.test.tsx で確かめる）
  });

  it("while the keyboard is shown (one-pane), hides the title but keeps ‹ and the tabs on one row", () => {
    // EditorScreen のヘッダと同じ骨組み（タブがヘッダの中、題の後にあることは EditorScreen.test.tsx で確かめる）
    const style = document.createElement("style");
    style.textContent = screen;
    document.head.append(style);
    document.body.innerHTML = `
      <div class="screen editor-screen" data-wide="false">
        <header class="topbar">
          <div class="topbar-main"><a data-slot="back" aria-label="記事一覧へ"><svg></svg></a><div class="topbar-text"><h1 class="topbar-title">題</h1></div></div>
          <nav data-slot="tabs-list" class="view-tabs"><button data-slot="tabs-trigger" class="tab">編集</button><button data-slot="tabs-trigger" class="tab">プレビュー</button></nav>
        </header>
      </div>`;
    const q = (sel: string) => getComputedStyle(document.querySelector(sel)!);
    try {
      expect(q(".topbar-text").display).toBe("flex");
      expect(q(".topbar").flexWrap).toBe("wrap");
      document.documentElement.setAttribute("data-kb", "");
      expect(q(".topbar-text").display).toBe("none");
      expect(q(".topbar").flexWrap).toBe("nowrap");
      expect(q(".view-tabs").display).not.toBe("none");
      expect(q("[data-slot=back]").display).not.toBe("none");
      for (const t of document.querySelectorAll(".tab")) expect(getComputedStyle(t).display).not.toBe("none");
      // 2 ペインでは題を隠さない
      document.querySelector(".editor-screen")!.setAttribute("data-wide", "true");
      expect(q(".topbar-text").display).toBe("flex");
    } finally {
      document.documentElement.removeAttribute("data-kb");
      document.body.innerHTML = "";
      style.remove();
    }
  });
});

describe("CodeMirror (styles/codemirror.css)", () => {
  it("is not put in a cascade layer (CodeMirror's own CSS is unlayered and would win)", () => {
    expect(css).toMatch(/@import "\.\/styles\/codemirror\.css";/);
    expect(css).toMatch(/@import "\.\/styles\/screen\.css" layer\(components\);/);
  });

  it("removes CodeMirror's dotted focus outline, and shows focus by the current line only while focused", () => {
    expect(cm).toMatch(/\.code-editor \.cm-editor\.cm-focused \{\s*outline: none;/);
    expect(cm).toMatch(
      /\.code-editor \.cm-editor:not\(\.cm-focused\) \.cm-activeLine:not\(\.cm-diag-line\),\s*\.code-editor \.cm-editor:not\(\.cm-focused\) \.cm-activeLineGutter \{\s*background: transparent;/,
    );
  });

  it("keeps the diagnostic color of the cursor line on narrow screens while the editor is not focused", () => {
    // 現在行の強調を消す規則（詳細度 0,5,0）は、狭い画面の診断の地の色（0,3,0）より強いので、診断の行を外しておく
    const rules = cm.match(/[^{}]*:not\(\.cm-focused\)[^{}]*\.cm-activeLine(?!Gutter)[^{,]*/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).toContain(":not(.cm-diag-line)");
    expect(cm).toMatch(/\.code-editor\[data-compact="true"\] \.cm-diag-error \{\s*background:/);
  });
});

describe("design rules (docs/design-system.md の「使い分けの規則」)", () => {
  const ui = sources.filter(([f]) => f.startsWith("components/ui/"));
  const screens = sources.filter(([f]) => !f.startsWith("components/ui/"));

  it("has the rules document in the repository", () => {
    const doc = read("../../docs/design-system.md");
    expect(doc).toContain("## 使い分けの規則");
    expect(css).toContain("docs/design-system.md");
  });

  it("finds class names in string literals only, after removing comments (the scanner this file relies on)", () => {
    const src = `// bg-commented
      /* rounded-commented */
      const a = "hover:bg-x! !shadow-y";
      <Button className={cn(\`p-3 \${x ? "text-caption" : ""}\`, "[background:red]")} />
      <div className="text-body">{/* font-bold */}</div>`;
    expect(classTokens(src).map(utility)).toEqual(["bg-x", "shadow-y", "p-3", "text-caption", "[background:red]", "text-body"]);
    expect(componentClassNames(src)).toEqual([{ tag: "Button", classes: ["p-3", "text-caption", "[background:red]"] }]);
    expect(utility("[:is([data-slot=a],[data-slot=b])+&]:pt-0")).toBe("pt-0");
    expect(utility("-mx-4")).toBe("mx-4");
  });

  it("uses no arbitrary values for text, radius, color, shadow, padding, margin or gap (sizes, max-h and grid templates may; the safe-area calc is allowed)", () => {
    for (const [file, src] of sources) {
      const bad = classTokens(src)
        .map(utility)
        .filter((c) => /^(text|rounded(-[trblse]{1,2})?|bg|shadow|outline|p[xytrblse]?|m[xytrblse]?|gap(-[xy])?|space-[xy])-\[/.test(c) && !/env\(/.test(c));
      expect(bad, file).toEqual([]);
    }
  });

  it("keeps surfaces, radii, shadows and weights inside components/ui (screens only place and size the parts)", () => {
    for (const [file, src] of screens) {
      const bad = classTokens(src)
        .map(utility)
        .filter((c) => /^(bg|rounded|shadow|surface)(-|$)/.test(c) || c === "font-bold" || /^\[[a-z-]+:/.test(c));
      expect(bad, file).toEqual([]);
      // style 属性で地・角丸・影・文字・余白を書かない
      for (const m of stripComments(src).matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
        expect(m[1], file).not.toMatch(/\b(background|color|border|borderRadius|boxShadow|font\w*|padding\w*)\s*:/);
      }
    }
    for (const [file, src] of ui) expect(classTokens(src).map(utility), file).not.toContain("font-bold");
  });

  it("does not override the text size, weight or padding of a part through className (screens may set text roles on plain elements)", () => {
    for (const [file, src] of screens) {
      for (const { tag, classes } of componentClassNames(src)) {
        const bad = classes.map(utility).filter((c) => /^(text-(caption|body|title|screen|input)|font-(semibold|medium|normal|bold)|p[xytrblse]?-)/.test(c));
        expect(bad, `${file} <${tag}>`).toEqual([]);
      }
    }
  });

  it("uses the spacing scale 4 / 8 / 12 / 16 / 24 / 32 (+2 inside a line, 44 for the hit area) for padding, margin and gap (not for inset, size or translate)", () => {
    const allowed = new Set(["0", "0.5", "1", "2", "3", "4", "6", "8", "11"]);
    for (const [file, src] of sources) {
      const used = classTokens(src)
        .map(utility)
        .flatMap((c) => /^(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?)-(\d+(?:\.\d+)?)$/.exec(c)?.[1] ?? []);
      expect(used.filter((v) => !allowed.has(v)), file).toEqual([]);
    }
    for (const [name, text] of [["screen.css", screen], ["codemirror.css", cm]] as const) {
      for (const m of text.matchAll(/\n\s*(padding|margin|gap|column-gap|row-gap)[\w-]*:\s*([^;]+);/g)) {
        for (const v of m[2].match(/\d+px/g) ?? []) expect(["0px", "2px", "4px", "8px", "12px", "16px", "24px", "32px"], `${name}: ${m[0].trim()}`).toContain(v);
      }
    }
  });

  it("sets font sizes in the CSS only from the text tokens (the editor and inputs use the input size)", () => {
    for (const [name, text] of [["styles.css", css.slice(css.indexOf("@layer base"))], ["screen.css", screen], ["codemirror.css", cm]] as const) {
      for (const m of text.matchAll(/font-size:\s*([^;]+);/g)) expect(m[1], name).toMatch(/^var\(--text-(caption|body|title|screen|input)\)$/);
    }
  });

  it("draws icons with lucide-react, not with text symbols", () => {
    for (const [file, src] of sources) {
      // JSX の文字として置いた記号（‹ ↶ ⇄ ▶ − ＋ × ?）
      expect(src.match(/>\s*[‹↶⇄▶−＋×]\s*</g), file).toBeNull();
      expect(src, file).not.toMatch(/content-\['[▶‹]/);
    }
    const imports = sources.flatMap(([, src]) => [...src.matchAll(/from "lucide-react"/g)]);
    expect(imports.length).toBeGreaterThan(0);
    // 名前付きの import だけ（全部を読み込まない）
    for (const [file, src] of sources) expect(src, file).not.toMatch(/import \* as \w+ from "lucide-react"|from "lucide-react\/dynamic"/);
  });

  it("removes CodeMirror's lines in the lint tooltip", () => {
    expect(cm).toMatch(/\.code-editor \.cm-tooltip \{\s*border: 0;/);
    expect(cm).toMatch(/\.code-editor \.cm-tooltip \.cm-diagnostic \{\s*border: 0;/);
  });
});
