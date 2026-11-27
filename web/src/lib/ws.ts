import type { StudioEvent } from "../api/types";

// /api/ws（studio の通知）。切れたら間隔を伸ばしながら繋ぎ直す
type Listener = (e: StudioEvent) => void;

export class StudioSocket {
  private ws?: WebSocket;
  private listeners = new Set<Listener>();
  private reconnectListeners = new Set<() => void>();
  private retry = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private everOpened = false;

  constructor(private readonly url: string) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // 繋ぎ直したとき（切れている間の通知を取りこぼしたかもしれない）
  onReconnect(fn: () => void): () => void {
    this.reconnectListeners.add(fn);
    return () => this.reconnectListeners.delete(fn);
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      if (this.everOpened) this.reconnectListeners.forEach((f) => f());
      this.everOpened = true;
    };
    ws.onmessage = (m) => {
      let e: StudioEvent;
      try {
        e = JSON.parse(String(m.data)) as StudioEvent;
      } catch {
        return;
      }
      if (!e || typeof e.type !== "string") return;
      this.listeners.forEach((f) => f(e));
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.stopped) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }
}

export function studioSocketUrl(loc: Location = window.location): string {
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}/api/ws`;
}

let shared: StudioSocket | undefined;

export function getSocket(): StudioSocket {
  if (!shared) {
    shared = new StudioSocket(studioSocketUrl());
    shared.start();
  }
  return shared;
}
