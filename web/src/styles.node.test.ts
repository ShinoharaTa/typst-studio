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

// 画面と部品のソース（テストを除く）
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

  it("puts the editor and the toolbar on the same panel", () => {
    expect(rule(screen, ".pane-edit")).toContain("background: var(--card)");
    expect(rule(screen, ".editor-wrap")).toContain("background: var(--card)");
  });

  it("while the keyboard is shown (one-pane), hides the title but keeps ‹ and the tabs on one row", () => {
    // EditorScreen のヘッダと同じ骨組み（タブがヘッダの中、題の後にあることは EditorScreen.test.tsx で確かめる）
    const style = document.createElement("style");
    style.textContent = screen;
    document.head.append(style);
    document.body.innerHTML = `
      <div class="screen editor-screen" data-wide="false">
        <header class="topbar">
          <div class="topbar-main"><a class="icon-btn">‹</a><div class="topbar-text"><h1 class="topbar-title">題</h1></div></div>
          <nav class="view-tabs"><button class="tab">編集</button><button class="tab">プレビュー</button></nav>
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
      expect(q(".icon-btn").display).not.toBe("none");
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

describe("components", () => {
  it("does not read the arrow of 'continue' aloud", () => {
    const src = sources.find(([f]) => f.endsWith("ProjectList.tsx"))![1];
    expect(src).toContain("before:content-['▶_'/'']");
  });
});
