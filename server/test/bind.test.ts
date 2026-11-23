import { describe, expect, it } from "vitest";
import { assertBindAllowed, isLoopbackHost } from "../src/bind.js";

describe("bind check", () => {
  it("accepts loopback addresses", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "::1", "localhost"]) expect(isLoopbackHost(h)).toBe(true);
    expect(() => assertBindAllowed("127.0.0.1", false)).not.toThrow();
  });

  it("rejects non-loopback without TYPST_STUDIO_CONTAINER", () => {
    for (const h of ["0.0.0.0", "::", "100.64.0.1", "192.168.1.2", "example.com"]) {
      expect(isLoopbackHost(h)).toBe(false);
      expect(() => assertBindAllowed(h, false)).toThrow(/TYPST_STUDIO_CONTAINER=1/);
    }
  });

  it("allows non-loopback only in container mode", () => {
    expect(() => assertBindAllowed("0.0.0.0", true)).not.toThrow();
  });
});
