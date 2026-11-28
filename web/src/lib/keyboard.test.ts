import { describe, expect, it } from "vitest";
import { KeyboardDetector } from "./keyboard";

describe("KeyboardDetector", () => {
  it("Android: detects the keyboard when the whole viewport shrinks (inset stays 0)", () => {
    const d = new KeyboardDetector();
    expect(d.update(412, 860, 0)).toBe(false);
    expect(d.update(412, 480, 0)).toBe(true);
    expect(d.update(412, 860, 0)).toBe(false);
  });

  it("ignores small changes such as the address bar", () => {
    const d = new KeyboardDetector();
    d.update(412, 860, 0);
    expect(d.update(412, 800, 0)).toBe(false);
  });

  it("forgets the maximum when the width changes (rotation / unfolding)", () => {
    const d = new KeyboardDetector();
    d.update(412, 860, 0);
    // 横向きにした。高さは小さいがキーボードではない
    expect(d.update(860, 400, 0)).toBe(false);
    expect(d.update(860, 200, 0)).toBe(true);
  });

  it("iOS: detects the keyboard from the inset between innerHeight and visualViewport", () => {
    const d = new KeyboardDetector();
    expect(d.update(390, 844, 0)).toBe(false);
    expect(d.update(390, 500, 344)).toBe(true);
  });
});
