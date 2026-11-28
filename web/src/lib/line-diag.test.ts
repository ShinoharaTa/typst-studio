import { describe, expect, it } from "vitest";
import { diagSummary, sortDiags } from "./line-diag";

describe("line diagnostics", () => {
  it("puts errors first, keeping the order otherwise", () => {
    const ds = sortDiags([
      { severity: "warning" as const, message: "unused" },
      { severity: "error" as const, message: "unknown variable: x" },
      { severity: "warning" as const, message: "later" },
    ]);
    expect(ds.map((d) => d.message)).toEqual(["unknown variable: x", "unused", "later"]);
  });

  it("summarizes them in one line", () => {
    expect(diagSummary(sortDiags([{ severity: "warning", message: "unused" }, { severity: "error", message: "x" }]))).toBe(
      "エラー（2 件）: x / unused",
    );
    expect(diagSummary([{ severity: "error", message: "expected expression" }])).toBe("エラー: expected expression");
    expect(diagSummary([])).toBe("");
  });
});
