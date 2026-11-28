import { describe, expect, it } from "vitest";
import {
  capturePosition,
  layoutPages,
  PAGE_GAP,
  pageAt,
  pagesToPrerender,
  restoreScrollTop,
  stepZoom,
  totalHeight,
} from "./pdfpos";

const uniform = (n: number, h: number) => layoutPages(Array.from({ length: n }, () => h));

describe("layout", () => {
  it("stacks pages with gaps", () => {
    const l = uniform(3, 100);
    expect(l.tops).toEqual([PAGE_GAP, PAGE_GAP * 2 + 100, PAGE_GAP * 3 + 200]);
    expect(totalHeight(l)).toBe(PAGE_GAP * 4 + 300);
  });

  it("finds the page at a position; the gap belongs to the next page", () => {
    const l = uniform(3, 100); // tops 12, 124, 236
    expect(pageAt(l, 0)).toBe(0);
    expect(pageAt(l, 50)).toBe(0);
    expect(pageAt(l, 115)).toBe(1); // 112〜124 は 2 ページ目の前の余白
    expect(pageAt(l, 124)).toBe(1);
    expect(pageAt(l, 10_000)).toBe(2);
  });
});

describe("capture / restore", () => {
  it("keeps page and ratio across a different page height (zoom or width change)", () => {
    const before = uniform(10, 1000);
    const scrollTop = before.tops[4] + 250; // 5 ページ目の 1/4
    const pos = capturePosition(before, scrollTop, 1.5);
    expect(pos).toEqual({ page: 5, ratio: 0.25, zoom: 1.5 });
    const after = uniform(12, 600);
    expect(restoreScrollTop(after, pos)).toBe(after.tops[4] + 150);
  });

  it("goes to the last page when the new PDF has fewer pages", () => {
    const before = uniform(10, 500);
    const pos = capturePosition(before, before.tops[8] + 100, 1);
    expect(pos.page).toBe(9);
    const after = uniform(5, 500);
    expect(restoreScrollTop(after, pos)).toBe(after.tops[4]);
  });

  it("clamps the ratio in the gaps and handles empty documents", () => {
    const l = uniform(3, 100);
    expect(capturePosition(l, 115, 1)).toEqual({ page: 2, ratio: 0, zoom: 1 });
    expect(capturePosition(l, 0, 1)).toEqual({ page: 1, ratio: 0, zoom: 1 });
    expect(capturePosition(layoutPages([]), 100, 2)).toEqual({ page: 1, ratio: 0, zoom: 2 });
    expect(restoreScrollTop(layoutPages([]), { page: 3, ratio: 0.5, zoom: 1 })).toBe(0);
  });

  it("round-trips on the same layout", () => {
    const l = uniform(20, 842);
    for (const y of [0, 500, 3000, l.tops[19] + 10]) {
      const back = restoreScrollTop(l, capturePosition(l, y, 1));
      expect(Math.abs(back - Math.max(y, l.tops[0]))).toBeLessThan(1e-6);
    }
  });
});

describe("pagesToPrerender", () => {
  it("returns the pages visible at the restored position", () => {
    const l = uniform(10, 300); // tops 12, 324, 636, ...
    expect(pagesToPrerender(l, l.tops[3] + 200, 400)).toEqual([3, 4]);
    expect(pagesToPrerender(l, l.tops[9], 2000)).toEqual([9]);
    expect(pagesToPrerender(layoutPages([]), 0, 100)).toEqual([]);
  });
});

describe("stepZoom", () => {
  it("moves between the fixed steps and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(1.1, 1)).toBe(1.25);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.5, -1)).toBe(0.5);
  });
});
