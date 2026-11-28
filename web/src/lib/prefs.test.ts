// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPref, writePref } from "./prefs";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("prefs", () => {
  it("reads the fallback, then what was written", () => {
    expect(readPref("typst-studio.test", "a")).toBe("a");
    writePref("typst-studio.test", "b");
    expect(readPref("typst-studio.test", "a")).toBe("b");
    expect(window.localStorage.getItem("typst-studio.test")).toBe("b");
  });

  it("keeps working in memory when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(readPref("typst-studio.broken", "x")).toBe("x");
    writePref("typst-studio.broken", "y");
    expect(readPref("typst-studio.broken", "x")).toBe("y");
  });

  it("prefers the in-memory value when setItem fails but an old value is still stored", () => {
    window.localStorage.setItem("typst-studio.full", "old");
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    writePref("typst-studio.full", "new");
    expect(readPref("typst-studio.full", "x")).toBe("new");
    // 書けるようになったら localStorage に戻る
    set.mockRestore();
    writePref("typst-studio.full", "newer");
    expect(window.localStorage.getItem("typst-studio.full")).toBe("newer");
    expect(readPref("typst-studio.full", "x")).toBe("newer");
  });
});
