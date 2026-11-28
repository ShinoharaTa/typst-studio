// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { EditToolbar, SAVING_SHOW_MS, TOOLBAR_CHARS } from "./EditToolbar";

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

  it("marks Save as aria-disabled (not disabled) when there is nothing to save, so pressing it keeps the focus", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onSave = vi.fn();
    await act(async () => root.render(<EditToolbar onSave={onSave} onUndo={() => undefined} onInsert={() => undefined} saveDisabled />));
    const save = host.querySelector<HTMLButtonElement>(".tb-save")!;
    expect(save.disabled).toBe(false);
    expect(save.getAttribute("aria-disabled")).toBe("true");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    save.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    await act(async () => save.click());
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => root.render(<EditToolbar onSave={onSave} onUndo={() => undefined} onInsert={() => undefined} saveDisabled={false} />));
    expect(save.getAttribute("aria-disabled")).toBe("false");
    await act(async () => save.click());
    expect(onSave).toHaveBeenCalledTimes(1);
    // 読み取り専用（画像シート）のときは、ツールバーごと無効の印を付ける
    expect(host.querySelector(".edit-toolbar")?.getAttribute("data-locked")).toBe("false");
    await act(async () =>
      root.render(<EditToolbar onSave={onSave} onUndo={() => undefined} onInsert={() => undefined} saveDisabled={false} disabled />),
    );
    expect(host.querySelector(".edit-toolbar")?.getAttribute("data-locked")).toBe("true");
    expect(save.getAttribute("aria-disabled")).toBe("true");
    await act(async () => save.click());
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    host.remove();
  });
  it("shows the save state on Save itself, at a fixed width", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onSave = vi.fn();
    const render = (state: "clean" | "dirty" | "saving" | "conflict" | "error") =>
      act(async () =>
        root.render(
          <EditToolbar
            onSave={onSave}
            onUndo={() => undefined}
            onInsert={() => undefined}
            saveState={state}
            saveDisabled={state === "clean" || state === "saving"}
          />,
        ),
      );
    const save = () => host.querySelector<HTMLButtonElement>(".tb-save")!;
    const seen: [string, string | null, string | null][] = [];
    vi.useFakeTimers();
    try {
      for (const st of ["clean", "dirty", "saving", "conflict", "error"] as const) {
        await render(st);
        // 「保存中」は長引いたときだけ出す
        if (st === "saving") await act(async () => vi.advanceTimersByTime(SAVING_SHOW_MS));
        seen.push([save().textContent!, save().dataset.state ?? null, save().getAttribute("aria-disabled")]);
      }
    } finally {
      vi.useRealTimers();
    }
    expect(seen).toEqual([
      ["保存済", "clean", "true"],
      ["保存", "dirty", "false"],
      ["保存中", "saving", "true"],
      ["衝突", "conflict", "false"],
      ["再試行", "error", "false"],
    ]);
    // 失敗したときは押すともう一度保存する
    await act(async () => save().click());
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    host.remove();
  });

  it("shows 'saving' only when the save takes longer than SAVING_SHOW_MS, keeping the previous look until then", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (state: "clean" | "dirty" | "saving" | "error") =>
      act(async () =>
        root.render(
          <EditToolbar
            onSave={() => undefined}
            onUndo={() => undefined}
            onInsert={() => undefined}
            saveState={state}
            saveDisabled={state === "clean" || state === "saving"}
          />,
        ),
      );
    const save = () => host.querySelector<HTMLButtonElement>(".tb-save")!;
    const look = () => [save().textContent, save().dataset.state];
    try {
      // すぐ終わる保存: 保存 → 保存済（「保存中」をはさまない）
      await render("dirty");
      await render("saving");
      expect(look()).toEqual(["保存", "dirty"]);
      await act(async () => vi.advanceTimersByTime(SAVING_SHOW_MS - 1));
      expect(look()).toEqual(["保存", "dirty"]);
      await render("clean");
      expect(look()).toEqual(["保存済", "clean"]);
      // 長引いた保存
      await render("dirty");
      await render("saving");
      await act(async () => vi.advanceTimersByTime(SAVING_SHOW_MS));
      expect(look()).toEqual(["保存中", "saving"]);
      // 再試行の間は、長引くまで「再試行」のまま
      await render("error");
      await render("saving");
      expect(look()).toEqual(["再試行", "error"]);
      await act(async () => vi.advanceTimersByTime(SAVING_SHOW_MS));
      expect(look()).toEqual(["保存中", "saving"]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });
});
