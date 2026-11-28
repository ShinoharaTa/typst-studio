// @vitest-environment jsdom
// styles.css のトークンの検査（線を使わない取り決めと、文字のコントラスト）と、jsdom に当てて算出したスタイルの検査
// （vitest は CSS の import を空にするので、ファイルを直接読む。型は tsconfig.node-test.json で検査する）
// 制約: jsdom の getComputedStyle は詳細度を見ない（後に書いた規則が勝つ）。
//   規則どうしの勝ち負け（詳細度の高い規則が別の規則を打ち消すか）はここでは確かめられないので、
//   セレクタの形を正規表現で確かめ、実際の見え方は Chromium で確かめる
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.join(import.meta.dirname, "styles.css"), "utf8");
const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const light = css.slice(0, darkStart);
const dark = css.slice(darkStart, css.indexOf("\n}\n", darkStart));

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

describe("styles.css", () => {
  it("does not draw lines (only border: 0, radius, box-sizing and the cursor)", () => {
    const lines = css.split("\n").filter((l) => /border/.test(l));
    const bad = lines.filter((l) => !/border: 0|border-radius|box-sizing|border-left-color/.test(l));
    expect(bad).toEqual([]);
    expect(css).not.toContain("var(--border)");
  });

  it("keeps the comment color at 4.5:1 or more on the editor panel, in light and dark", () => {
    for (const block of [light, dark]) {
      expect(contrast(token(block, "hl-comment"), token(block, "panel"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives no hover or press feedback to aria-disabled toolbar keys, and dims Save while locked", () => {
    const hover = /\.tb-btn:hover[^{,]*/.exec(css)?.[0] ?? "";
    expect(hover).toContain(':not([aria-disabled="true"])');
    const presses = css.match(/\.tb-btn:active[^{,]*/g) ?? [];
    expect(presses.length).toBeGreaterThan(0);
    for (const p of presses) expect(p).toContain(':not([aria-disabled="true"])');
    expect(css).toMatch(/\.edit-toolbar\[data-locked="true"\] \.tb-save \{\s*opacity: 0\.5;/);
  });

  it("removes CodeMirror's dotted focus outline, and shows focus by the current line only while focused", () => {
    expect(css).toMatch(/\.code-editor \.cm-editor\.cm-focused \{\s*outline: none;/);
    expect(css).toMatch(
      /\.code-editor \.cm-editor:not\(\.cm-focused\) \.cm-activeLine:not\(\.cm-diag-line\),\s*\.code-editor \.cm-editor:not\(\.cm-focused\) \.cm-activeLineGutter \{\s*background: transparent;/,
    );
  });

  it("keeps the diagnostic color of the cursor line on narrow screens while the editor is not focused", () => {
    // 現在行の強調を消す規則（詳細度 0,5,0）は、狭い画面の診断の地の色（0,3,0）より強いので、診断の行を外しておく
    const rules = css.match(/[^{}]*:not\(\.cm-focused\)[^{}]*\.cm-activeLine(?!Gutter)[^{,]*/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).toContain(":not(.cm-diag-line)");
    expect(css).toMatch(/\.code-editor\[data-compact="true"\] \.cm-diag-error \{\s*background:/);
  });

  it("keeps Save on one line at a fixed size and the same weight in every state, and lets tab labels shrink with an ellipsis", () => {
    const rule = (sel: string) => new RegExp(`\\n${sel.replace(/[.[\]]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(rule(".tb-save")).toMatch(/font-size: \d+px;/);
    expect(rule(".tb-save")).toContain("white-space: nowrap");
    expect(css.match(/\.tb-save[^{]*\{[^}]*font-weight[^}]*\}/g)).toHaveLength(1);
    expect(rule(".tab")).toMatch(/font-size: min\(/);
    expect(rule(".tab")).not.toContain("overflow");
    expect(rule(".tab-label")).toContain("text-overflow: ellipsis");
    // 未保存は塗りのアクセントにせず、薄い地にアクセントの文字
    expect(rule('.tb-save[data-state="dirty"]')).toContain("background: var(--accent-soft)");
    for (const block of [light, dark]) {
      expect(contrast(token(block, "accent"), token(block, "accent-soft"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "muted"), token(block, "panel"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("puts the toolbar on the editor's panel with box-colored keys, stretched to the full width", () => {
    const rule = (sel: string) => new RegExp(`\\n${sel.replace(/[.[\]]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(rule(".edit-toolbar")).toContain("background: var(--panel)");
    expect(rule(".pane-edit")).toContain("background: var(--panel)");
    expect(rule(".tb-btn")).toContain("background: var(--box)");
    expect(rule(".tb-char")).not.toContain("max-width");
  });

  it("sets the tabs apart on a track: the selected pill stands out in light and dark, and the labels stay readable", () => {
    for (const block of [light, dark]) {
      expect(contrast(token(block, "tab-on"), token(block, "tab-track"))).toBeGreaterThanOrEqual(1.3);
      expect(contrast(token(block, "accent"), token(block, "tab-on"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "muted"), token(block, "tab-track"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "muted"), token(block, "tab-press"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("reserves the room for the swap button with margins, so the neighbouring header columns never cover it", () => {
    const rules = [...css.matchAll(/\n(\.editor-screen\[data-wide="true"\][^{]*(?:\.topbar-main|\.topbar \.view-tabs)) \{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const [, sel, body] of rules) expect(body, sel).not.toMatch(/padding/);
    expect(css).toMatch(/\.swap-btn \{[^}]*z-index: 1;/);
  });

  it("while the keyboard is shown (one-pane), hides the title but keeps ‹ and the tabs on one row", () => {
    // EditorScreen のヘッダと同じ骨組み（タブがヘッダの中、題の後にあることは EditorScreen.test.tsx で確かめる）
    const style = document.createElement("style");
    style.textContent = css;
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
      expect(q(".view-tabs").display).toBe("flex");
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

  it("does not read the arrow of 'continue' aloud", () => {
    expect(css).toMatch(/\.continue-label::before \{\s*content: "▶ " \/ "";/);
  });

  it("keeps muted text at 4.5:1 or more on the pressed box color", () => {
    for (const block of [light, dark]) {
      expect(contrast(token(block, "muted"), token(block, "box-press"))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
