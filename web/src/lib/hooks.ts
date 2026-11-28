import { useEffect, useRef, useSyncExternalStore } from "react";
import type { StudioEvent } from "../api/types";
import { isEditable, KeyboardDetector } from "./keyboard";
import { getSocket } from "./ws";

// /api/ws の通知を受ける。fn は毎回の最新を使う
export function useStudioEvent(fn: (e: StudioEvent) => void, onReconnect?: () => void): void {
  const ref = useRef(fn);
  const reRef = useRef(onReconnect);
  ref.current = fn;
  reRef.current = onReconnect;
  useEffect(() => {
    const s = getSocket();
    const off1 = s.on((e) => ref.current(e));
    const off2 = s.onReconnect(() => reRef.current?.());
    return () => {
      off1();
      off2();
    };
  }, []);
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    () => document.visibilityState === "visible",
  );
}

// ソフトキーボードで隠れる高さを --kb に入れ（iOS は表示領域が縮まず、visualViewport だけが縮む）、
// キーボードが出ている間は data-kb を付ける（判定は KeyboardDetector。編集できる要素にフォーカスがあるときだけ）
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const detector = new KeyboardDetector();
    let editing = isEditable(document.activeElement);
    const update = () => {
      const inset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      root.style.setProperty("--kb", `${Math.round(inset)}px`);
      const kb = detector.update({
        width: Math.round(vv.width),
        height: vv.height,
        inset,
        editing,
        innerHeight: window.innerHeight,
        screenHeight: window.screen?.availHeight,
      });
      root.toggleAttribute("data-kb", kb);
    };
    const onFocusIn = (e: FocusEvent) => {
      editing = isEditable(e.target as Element | null);
      update();
    };
    // focusout の時点では activeElement が定まらないので、移り先（relatedTarget）で見る
    const onFocusOut = (e: FocusEvent) => {
      editing = isEditable(e.relatedTarget as Element | null);
      update();
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      root.removeAttribute("data-kb");
    };
  }, []);
}
