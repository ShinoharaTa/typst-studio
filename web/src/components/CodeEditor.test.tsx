// @vitest-environment jsdom
import { Text } from "@codemirror/state";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { buildLineMarks, CodeEditor, type CodeEditorHandle, type LineDiagnostic } from "./CodeEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  document.body.innerHTML = "";
});

const DIAGS: LineDiagnostic[] = [
  { line: 2, column: 1, severity: "warning", message: "w" },
  { line: 2, column: 3, severity: "error", message: "e" },
  { line: 3, column: null, severity: "warning", message: "w2" },
  { line: 99, column: 1, severity: "error", message: "out of range" },
];

async function render(compact: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  const ref = createRef<CodeEditorHandle>();
  const root = createRoot(host);
  const props = { onDocChange: () => undefined, onCursor: () => undefined, onSave: () => undefined };
  await act(async () => root.render(<CodeEditor ref={ref} {...props} compact={compact} diagnostics={[]} />));
  await act(async () => ref.current!.setDoc("a\nb\nc\n", { resetHistory: true }));
  await act(async () => root.render(<CodeEditor ref={ref} {...props} compact={compact} diagnostics={DIAGS} />));
  return { host, root };
}

describe("CodeEditor line diagnostics", () => {
  it("marks each line once, errors over warnings, skipping lines out of range", () => {
    const set = buildLineMarks(Text.of(["a", "b", "c"]), DIAGS);
    const marks: { from: number; cls: string }[] = [];
    set.between(0, 100, (from, _to, d) => void marks.push({ from, cls: d.spec.class as string }));
    expect(marks).toEqual([
      { from: 2, cls: "cm-diag-line cm-diag-error" },
      { from: 4, cls: "cm-diag-line cm-diag-warning" },
    ]);
  });

  it("drops the lint gutter on narrow screens and keeps the line numbers", async () => {
    const { host, root } = await render(true);
    expect(host.querySelector(".code-editor")?.getAttribute("data-compact")).toBe("true");
    expect(host.querySelector(".cm-gutter-lint")).toBeNull();
    expect(host.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(host.querySelectorAll(".cm-diag-line").length).toBe(2);
    await act(async () => root.unmount());
  });

  it("keeps the lint gutter on wide screens", async () => {
    const { host, root } = await render(false);
    expect(host.querySelector(".cm-gutter-lint")).not.toBeNull();
    await act(async () => root.unmount());
  });
});
