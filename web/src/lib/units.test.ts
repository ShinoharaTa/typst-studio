import { describe, expect, it } from "vitest";
import { formatLength, isValidLength, parseLength, toMm } from "./units";

describe("lengths", () => {
  it("parses the forms the server accepts", () => {
    expect(parseLength("70%")).toEqual({ value: 70, unit: "%" });
    expect(parseLength("32mm")).toEqual({ value: 32, unit: "mm" });
    expect(parseLength("8.5em")).toEqual({ value: 8.5, unit: "em" });
    expect(parseLength("50% + 1cm")).toBeNull();
    expect(parseLength("auto")).toBeNull();
    expect(parseLength(null)).toBeNull();
  });

  it("formats without trailing zeros and never produces an invalid value", () => {
    expect(formatLength(70, "%")).toBe("70%");
    expect(formatLength(12.3456, "mm")).toBe("12.35mm");
    expect(formatLength(-3, "mm")).toBe("0mm");
    expect(formatLength(Number.NaN, "%")).toBe("0%");
    expect(isValidLength(formatLength(1e-9, "mm"))).toBe(true);
    expect(isValidLength("1e3mm")).toBe(false);
  });

  it("converts absolute lengths to mm", () => {
    expect(toMm({ value: 3, unit: "cm" })).toBe(30);
    expect(toMm({ value: 1, unit: "in" })).toBeCloseTo(25.4);
    expect(toMm({ value: 72, unit: "pt" })).toBeCloseTo(25.4);
    expect(toMm({ value: 50, unit: "%" })).toBeNull();
  });
});
