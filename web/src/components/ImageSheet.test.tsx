// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ImageCall } from "../api/types";
import { ImageSheet } from "./ImageSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 非リテラルの呼び出し（API を呼ばずに出せる）
const CALL: ImageCall = {
  path: "a.typ",
  start: 0,
  end: 10,
  line: 1,
  column: 2,
  src: null,
  resolved: null,
  editable: false,
  width: null,
  height: null,
  alt: null,
};

afterEach(() => {
  document.body.innerHTML = "";
});

async function render(side: "left" | "right" | null) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<ImageSheet project="sample-book" target={{ call: CALL, rev: "r" }} onClose={() => undefined} onGoto={() => undefined} side={side} />),
  );
  return root;
}

describe("ImageSheet", () => {
  it("is placed on the editor's side in two-pane mode", async () => {
    for (const side of ["left", "right"] as const) {
      const root = await render(side);
      expect(document.querySelector<HTMLElement>(".sheet-viewport")?.dataset.side).toBe(side);
      await act(async () => root.unmount());
    }
  });

  it("is centered in one-pane mode", async () => {
    const root = await render(null);
    expect(document.querySelector(".sheet-viewport")?.hasAttribute("data-side")).toBe(false);
    expect(document.body.textContent).toContain("編集不可");
    await act(async () => root.unmount());
  });
});
