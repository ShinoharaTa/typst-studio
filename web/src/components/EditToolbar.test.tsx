// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { EditToolbar, TOOLBAR_CHARS } from "./EditToolbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("EditToolbar", () => {
  it("keeps the editor focused: prevents both pointerdown and mousedown on every key", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onInsert = vi.fn();
    await act(async () =>
      root.render(<EditToolbar onSave={() => undefined} onUndo={() => undefined} onInsert={onInsert} saveDisabled={false} />),
    );
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons).toHaveLength(2 + TOOLBAR_CHARS.length);
    for (const b of buttons) {
      for (const type of ["pointerdown", "mousedown"]) {
        const ev = new (type === "pointerdown" && "PointerEvent" in window ? PointerEvent : MouseEvent)(type, {
          bubbles: true,
          cancelable: true,
        });
        b.dispatchEvent(ev);
        expect(ev.defaultPrevented, `${type} on ${b.textContent}`).toBe(true);
      }
    }
    await act(async () => buttons[buttons.length - 1].click());
    expect(onInsert).toHaveBeenCalledWith('"');
    await act(async () => root.unmount());
    host.remove();
  });
});
