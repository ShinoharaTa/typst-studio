import { useEffect, useRef, useSyncExternalStore } from "react";
import type { StudioEvent } from "../api/types";
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

// ソフトキーボードで隠れる高さを --kb に入れる（iOS は表示領域が縮まず、visualViewport だけが縮む）
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      root.style.setProperty("--kb", `${Math.round(inset)}px`);
      root.toggleAttribute("data-kb", inset > 80);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
}
