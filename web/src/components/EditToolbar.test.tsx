// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { EditToolbar, SAVING_MIN_MS, SAVING_SHOW_MS, TOOLBAR_CHARS } from "./EditToolbar";

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
        // 出した「保存中」は最短の間だけ保つので、それを過ぎてから次へ
        if (st === "saving") await act(async () => vi.advanceTimersByTime(SAVING_MIN_MS));
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
      await act(async () => vi.advanceTimersByTime(SAVING_MIN_MS));
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
  it("keeps 'saving' shown for SAVING_MIN_MS once shown, even when the save ends just after it appeared", async () => {
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
    const look = () => [save().textContent, save().dataset.state, save().getAttribute("aria-disabled")];
    try {
      // 450ms の保存: 保存 → 保存中（500ms）→ 保存済。51ms で消えない
      await render("dirty");
      await render("saving");
      await act(async () => vi.advanceTimersByTime(SAVING_SHOW_MS));
      expect(look()).toEqual(["保存中", "saving", "true"]);
      await act(async () => vi.advanceTimersByTime(50));
      await render("clean");
      expect(look()).toEqual(["保存中", "saving", "true"]);
      await act(async () => vi.advanceTimersByTime(SAVING_MIN_MS - 51));
      expect(look()).toEqual(["保存中", "saving", "true"]);
      await act(async () => vi.advanceTimersByTime(1));
      expect(look()).toEqual(["保存済", "clean", "true"]);
      // 保っている間に次の保存が始まっても「保存中」のまま。失敗は保ちが終わってから出す
      await render("dirty");
      await render("saving");
      await act(async () => vi.advanceTimersByTime(SAVING_SHOW_MS));
      await act(async () => vi.advanceTimersByTime(100));
      await render("dirty");
      expect(look()).toEqual(["保存中", "saving", "true"]);
      await render("saving");
      await act(async () => vi.advanceTimersByTime(100));
      await render("error");
      expect(look()).toEqual(["保存中", "saving", "true"]);
      await act(async () => vi.advanceTimersByTime(SAVING_MIN_MS));
      expect(look()).toEqual(["再試行", "error", "false"]);
      // 長く掛かった保存は、終わったらすぐ切り替える
      await render("saving");
      await act(async () => vi.advanceTimersByTime(SAVING_SHOW_MS + SAVING_MIN_MS));
      await render("clean");
      expect(look()).toEqual(["保存済", "clean", "true"]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it("matches aria-disabled to what Save shows while 'saving' is still hidden", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onSave = vi.fn();
    const render = (state: "clean" | "dirty" | "saving") =>
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
    try {
      await render("dirty");
      await render("saving");
      expect([save().textContent, save().getAttribute("aria-disabled")]).toEqual(["保存", "false"]);
      await act(async () => save().click());
      expect(onSave).toHaveBeenCalledTimes(1);
      await act(async () => vi.advanceTimersByTime(SAVING_SHOW_MS));
      expect([save().textContent, save().getAttribute("aria-disabled")]).toEqual(["保存中", "true"]);
      // 保存済みから始まった保存（閉じる前の flush など）は、隠している間も押せない見た目のまま
      await render("clean");
      await act(async () => vi.advanceTimersByTime(SAVING_MIN_MS));
      await render("saving");
      expect([save().textContent, save().getAttribute("aria-disabled")]).toEqual(["保存済", "true"]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it("leaves no timer behind when unmounted while saving or while keeping 'saving' shown", async () => {
    vi.useFakeTimers();
    try {
      for (const when of ["hidden", "holding"] as const) {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        const render = (state: "dirty" | "saving" | "clean") =>
          act(async () =>
            root.render(
              <EditToolbar
                onSave={() => undefined}
                onUndo={() => undefined}
                onInsert={() => undefined}
                saveState={state}
                saveDisabled={state !== "dirty"}
              />,
            ),
          );
        await render("dirty");
        await render("saving");
        if (when === "holding") {
          await act(async () => vi.advanceTimersByTime(SAVING_SHOW_MS));
          await render("clean");
        }
        expect(vi.getTimerCount(), when).toBe(1);
        await act(async () => root.unmount());
        expect(vi.getTimerCount(), when).toBe(0);
        host.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });
  it("styles the keys from the design system: box-colored keys on the panel, no feedback while aria-disabled, Save at a fixed size", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (p: { disabled?: boolean; saveDisabled?: boolean }) =>
      act(async () =>
        root.render(
          <EditToolbar onSave={() => undefined} onUndo={() => undefined} onInsert={() => undefined} saveDisabled={p.saveDisabled ?? false} disabled={p.disabled} />,
        ),
      );
    await render({});
    const bar = host.querySelector<HTMLElement>(".edit-toolbar")!;
    const tokens = (el: Element) => el.className.split(/\s+/);
    expect(tokens(bar)).toContain("bg-card");
    for (const b of host.querySelectorAll("button")) {
      // 押した・ホバーの反応は、disabled と aria-disabled のキーには出さない
      for (const t of tokens(b).filter((t) => /(^|:)(hover|active):/.test(t))) expect(t, b.textContent!).toContain("not-aria-disabled:");
      expect(tokens(b)).toContain("rounded-key");
    }
    for (const c of host.querySelectorAll(".tb-char")) {
      expect(tokens(c)).toContain("bg-secondary");
      expect(tokens(c)).toContain("flex-1");
      expect(c.className).not.toMatch(/max-w-/);
    }
    const save = host.querySelector(".tb-save")!;
    // 文字は px で固定・折り返さない。太さは全状態で同じ。未保存は塗りの primary にせず、accent の地に primary の文字
    expect(tokens(save)).toEqual(expect.arrayContaining(["text-[14px]", "whitespace-nowrap", "font-semibold", "w-14"]));
    expect(save.className).not.toMatch(/data-\[state=[a-z]+\]:font-/);
    expect(tokens(save)).toEqual(expect.arrayContaining(["data-[state=dirty]:bg-accent", "data-[state=dirty]:text-primary"]));
    expect(save.className).not.toMatch(/bg-primary/);
    // 画像シートを開いている間は、保存もほかのキーと同じく薄くする
    expect(tokens(save)).toContain("in-data-[locked=true]:opacity-50");
    await render({ disabled: true });
    expect(bar.dataset.locked).toBe("true");
    await act(async () => root.unmount());
    host.remove();
  });
});
