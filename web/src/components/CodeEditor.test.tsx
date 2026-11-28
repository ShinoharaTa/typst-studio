// @vitest-environment jsdom
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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

  it("reports the diagnostics of the cursor line from the lint state, following edits", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const ref = createRef<CodeEditorHandle>();
    const root = createRoot(host);
    const seen: string[][] = [];
    const props = {
      onDocChange: () => undefined,
      onCursor: () => undefined,
      onSave: () => undefined,
      onCursorDiagnostics: (ds: { message: string }[]) => seen.push(ds.map((d) => d.message)),
    };
    await act(async () => root.render(<CodeEditor ref={ref} {...props} diagnostics={[]} />));
    await act(async () => ref.current!.setDoc("a\nb\nc\n", { resetHistory: true }));
    await act(async () => root.render(<CodeEditor ref={ref} {...props} diagnostics={DIAGS} />));
    await act(async () => ref.current!.goto(2));
    expect(seen.at(-1)).toEqual(["e", "w"]);
    // 先頭に 2 行足すと、診断は 4 行目へずれる。2 行目（今は "a" の次の新しい行）には無い
    await act(async () => {
      ref.current!.goto(1);
      ref.current!.insert("x\ny\n");
    });
    await act(async () => ref.current!.goto(2));
    expect(seen.at(-1)).toEqual([]);
    await act(async () => ref.current!.goto(4));
    expect(seen.at(-1)).toEqual(["e", "w"]);
    await act(async () => root.unmount());
  });

  it("reserves a bottom scroll margin only while something covers the bottom of the editor", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const props = { onDocChange: () => undefined, onCursor: () => undefined, onSave: () => undefined };
    const bottoms = () => {
      const v = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement)!;
      return v.state.facet(EditorView.scrollMargins).map((f) => f(v)?.bottom ?? 0);
    };
    await act(async () => root.render(<CodeEditor {...props} bottomInset={0} />));
    expect(bottoms().filter((b) => b > 0)).toEqual([]);
    await act(async () => root.render(<CodeEditor {...props} bottomInset={72} />));
    expect(bottoms()).toContain(72);
    await act(async () => root.render(<CodeEditor {...props} bottomInset={0} />));
    expect(bottoms().filter((b) => b > 0)).toEqual([]);
    await act(async () => root.unmount());
  });

  it("scrolls the cursor above the bottom only when the inset grows (not when it shrinks or stays)", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const props = { onDocChange: () => undefined, onCursor: () => undefined, onSave: () => undefined };
    await act(async () => root.render(<CodeEditor {...props} bottomInset={12} />));
    const v = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement)!;
    // scrollIntoView の effect は型が公開されていないので、値（ScrollTarget）の形で見分ける
    const scrolls: number[] = [];
    const orig = v.dispatch.bind(v);
    v.dispatch = ((...args: Parameters<EditorView["dispatch"]>) => {
      const spec = args[0] as { effects?: { value: unknown }[] };
      const n = (spec.effects ?? []).filter((e) => typeof e.value === "object" && e.value !== null && "range" in e.value && "y" in e.value).length;
      scrolls.push(n);
      return orig(...(args as [never]));
    }) as EditorView["dispatch"];
    const set = (b: number) => act(async () => root.render(<CodeEditor {...props} bottomInset={b} />));
    await set(72);
    await set(40);
    await set(12);
    await set(12);
    await set(60);
    expect(scrolls).toEqual([1, 0, 0, 1]);
    await act(async () => root.unmount());
  });

  it("keeps the lint gutter on wide screens", async () => {
    const { host, root } = await render(false);
    expect(host.querySelector(".cm-gutter-lint")).not.toBeNull();
    await act(async () => root.unmount());
  });
});
