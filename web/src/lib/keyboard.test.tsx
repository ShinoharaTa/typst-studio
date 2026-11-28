// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useKeyboardInset } from "./hooks";
import { isEditable, KeyboardDetector } from "./keyboard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const s = (width: number, height: number, editing: boolean, inset = 0, extra: object = {}) => ({ width, height, inset, editing, ...extra });

describe("KeyboardDetector", () => {
  it("Android: detects the keyboard when the viewport shrinks while editing", () => {
    const d = new KeyboardDetector();
    expect(d.update(s(412, 860, false))).toBe(false);
    expect(d.update(s(412, 860, true))).toBe(false);
    expect(d.update(s(412, 480, true))).toBe(true);
    expect(d.update(s(412, 860, true))).toBe(false);
  });

  it("does not report a keyboard when only the height shrinks without focus (split screen, window, DevTools)", () => {
    const d = new KeyboardDetector();
    d.update(s(412, 860, false));
    expect(d.update(s(412, 400, false))).toBe(false);
    // フォーカスが外れたら解く
    d.update(s(412, 860, false));
    expect(d.update(s(412, 480, true))).toBe(true);
    expect(d.update(s(412, 480, false))).toBe(false);
  });

  it("ignores small changes such as the address bar", () => {
    const d = new KeyboardDetector();
    d.update(s(412, 860, false));
    expect(d.update(s(412, 800, true))).toBe(false);
  });

  it("after rotating with the keyboard open, estimates the maximum from innerHeight and the screen", () => {
    const d = new KeyboardDetector();
    d.update(s(412, 860, false));
    expect(d.update(s(412, 480, true))).toBe(true);
    // 横向きにした（キーボードは出たまま）。画面の高さ 412 からブラウザの UI を引いても 200 より大きい
    expect(d.update(s(915, 150, true, 0, { innerHeight: 150, screenHeight: 412 }))).toBe(true);
    // 幅が変わり、キーボードが出ていない高さ
    const e = new KeyboardDetector();
    expect(e.update(s(915, 330, true, 0, { innerHeight: 330, screenHeight: 412 }))).toBe(false);
  });

  it("iOS: detects the keyboard from the inset, only while editing", () => {
    const d = new KeyboardDetector();
    expect(d.update(s(390, 844, false))).toBe(false);
    expect(d.update(s(390, 500, true, 344))).toBe(true);
    expect(d.update(s(390, 500, false, 344))).toBe(false);
  });
});

describe("isEditable", () => {
  it("accepts text inputs, textareas and contenteditable, not buttons or checkboxes", () => {
    const el = (html: string) => {
      const d = document.createElement("div");
      d.innerHTML = html;
      return d.firstElementChild!;
    };
    expect(isEditable(el("<input type='text'>"))).toBe(true);
    expect(isEditable(el("<input type='number'>"))).toBe(true);
    expect(isEditable(el("<input type='checkbox'>"))).toBe(false);
    expect(isEditable(el("<input type='range'>"))).toBe(false);
    expect(isEditable(el("<textarea></textarea>"))).toBe(true);
    expect(isEditable(el("<textarea readonly></textarea>"))).toBe(false);
    expect(isEditable(el("<div contenteditable='true'></div>"))).toBe(true);
    expect(isEditable(el("<button></button>"))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

describe("useKeyboardInset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("sets data-kb only while an editable element has focus, and clears it on blur", async () => {
    const listeners: Record<string, (() => void)[]> = {};
    const vv = {
      width: 412,
      height: 860,
      offsetTop: 0,
      addEventListener: (t: string, f: () => void) => (listeners[t] ??= []).push(f),
      removeEventListener: () => undefined,
    };
    vi.stubGlobal("visualViewport", vv);
    vi.stubGlobal("innerHeight", 860);
    const resize = (h: number) => {
      vv.height = h;
      (window as { innerHeight: number }).innerHeight = h;
      listeners.resize?.forEach((f) => f());
    };
    function Probe() {
      useKeyboardInset();
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const ta = document.createElement("textarea");
    const btn = document.createElement("button");
    document.body.append(ta, btn);
    const root = createRoot(host);
    await act(async () => root.render(<Probe />));
    const kb = () => document.documentElement.hasAttribute("data-kb");

    resize(480); // フォーカス無しで高さだけ縮む
    expect(kb()).toBe(false);
    resize(860);
    ta.focus();
    resize(480);
    expect(kb()).toBe(true);
    btn.focus(); // フォーカスが外れたら解く
    expect(kb()).toBe(false);
    await act(async () => root.unmount());
  });
});
