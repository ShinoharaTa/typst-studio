import { describe, expect, it } from "vitest";
import { codePointsToUtf16 } from "./text";

describe("codePointsToUtf16", () => {
  it("counts surrogate pairs as one code point", () => {
    expect(codePointsToUtf16("abc", 2)).toBe(2);
    expect(codePointsToUtf16("😀a", 1)).toBe(2);
    expect(codePointsToUtf16("😀a", 2)).toBe(3);
    expect(codePointsToUtf16("日本語", 2)).toBe(2);
    expect(codePointsToUtf16("ab", 10)).toBe(2);
  });
});
