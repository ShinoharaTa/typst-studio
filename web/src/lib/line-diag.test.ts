import { describe, expect, it } from "vitest";
import { diagsAtLine, diagSummary } from "./line-diag";

const D = [
  { line: 3, severity: "warning" as const, message: "unused" },
  { line: 3, severity: "error" as const, message: "unknown variable: x" },
  { line: 5, severity: "error" as const, message: "expected expression" },
];

describe("line diagnostics", () => {
  it("returns the diagnostics of the cursor line, errors first", () => {
    expect(diagsAtLine(D, 3).map((d) => d.severity)).toEqual(["error", "warning"]);
    expect(diagsAtLine(D, 4)).toEqual([]);
  });

  it("summarizes them in one line", () => {
    expect(diagSummary(diagsAtLine(D, 3))).toBe("エラー（2 件）: unknown variable: x / unused");
    expect(diagSummary(diagsAtLine(D, 5))).toBe("エラー: expected expression");
    expect(diagSummary([])).toBe("");
  });
});
