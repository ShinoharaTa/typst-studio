/// <reference types="node" />
// styles.css のトークンの検査（線を使わない取り決めと、文字のコントラスト）
// （vitest は CSS の import を空にするので、ファイルを直接読む）
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

  it("keeps muted text at 4.5:1 or more on the pressed box color", () => {
    for (const block of [light, dark]) {
      expect(contrast(token(block, "muted"), token(block, "box-press"))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
