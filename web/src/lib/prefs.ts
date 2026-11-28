import { useCallback, useSyncExternalStore } from "react";

// 端末ごとの設定（localStorage）。読めない・書けない環境でも、その画面の間は効く（メモリに持つ）

const memory = new Map<string, string>();
// 書き込みに失敗したキー。localStorage に残っている古い値より、メモリの値を優先する
const unsaved = new Set<string>();
const listeners = new Set<() => void>();

export function readPref(key: string, fallback: string): string {
  if (unsaved.has(key)) return memory.get(key) ?? fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    // 使えない環境
  }
  return memory.get(key) ?? fallback;
}

export function writePref(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
    unsaved.delete(key);
  } catch {
    // 保存できなくても、メモリの値で今の画面には効く
    unsaved.add(key);
  }
  listeners.forEach((f) => f());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // ほかのタブでの変更
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.storageArea === window.localStorage) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePref(key: string, fallback: string): [string, (v: string) => void] {
  const value = useSyncExternalStore(subscribe, () => readPref(key, fallback));
  const set = useCallback((v: string) => writePref(key, v), [key]);
  return [value, set];
}
