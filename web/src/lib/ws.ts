import type { StudioEvent } from "../api/types";

// /api/ws（studio の通知）。切れたら間隔を伸ばしながら繋ぎ直す。
// 画面が前に戻ったとき・回線が戻ったときはすぐ繋ぎ直す。"ping" に pong が返らなければ半開きとみなして切る
type Listener = (e: StudioEvent) => void;

export const PING_INTERVAL_MS = 25_000;
export const PONG_TIMEOUT_MS = 10_000;

// テストで差し替えられるように、使う WebSocket の形だけを書く
export interface SocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export class StudioSocket {
  private ws?: SocketLike;
  private listeners = new Set<Listener>();
  private reconnectListeners = new Set<() => void>();
  private retry = 0;
  private attempts = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private pongTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly create: (url: string) => SocketLike = (u) => new WebSocket(u) as unknown as SocketLike,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // 繋ぎ直したとき（切れている間・繋がる前の通知を取りこぼしたかもしれない）
  onReconnect(fn: () => void): () => void {
    this.reconnectListeners.add(fn);
    return () => this.reconnectListeners.delete(fn);
  }

  get open(): boolean {
    return this.ws?.readyState === 1;
  }

  // 前に戻った・回線が戻った。繋がっていなければ待たずに繋ぎ直し、繋がっていれば生きているか確かめる
  wake(): void {
    if (this.stopped) return;
    if (this.open) {
      this.ping();
      return;
    }
    if (this.ws && this.ws.readyState === 0) return;
    // 前の接続の ping・再接続の待ちは止める
    this.clearTimers();
    this.retry = 0;
    this.connect();
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.timer = this.pingTimer = this.pongTimer = undefined;
  }

  private ping(): void {
    if (!this.open || this.pongTimer) return;
    try {
      this.ws!.send("ping");
    } catch {
      return;
    }
    const ws = this.ws;
    this.pongTimer = setTimeout(() => {
      this.pongTimer = undefined;
      // 返事が無い。切って繋ぎ直す（onclose が来ないこともあるので自分で次へ進める）
      if (this.ws === ws) this.drop(ws!);
    }, PONG_TIMEOUT_MS);
  }

  private drop(ws: SocketLike): void {
    if (this.ws !== ws) return;
    this.ws = undefined;
    this.clearTimers();
    try {
      ws.close();
    } catch {
      // 既に閉じている
    }
    if (this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private connect(): void {
    if (this.stopped) return;
    this.attempts++;
    const ws = this.create(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      // 最初の 1 回で繋がったとき以外は、取りこぼしがありうるので取り直させる
      if (this.attempts > 1) this.reconnectListeners.forEach((f) => f());
      this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
    };
    ws.onmessage = (m) => {
      if (this.ws !== ws) return;
      let e: StudioEvent | { type: "pong" };
      try {
        e = JSON.parse(String(m.data)) as StudioEvent | { type: "pong" };
      } catch {
        return;
      }
      if (!e || typeof e.type !== "string") return;
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
      if (e.type === "pong") return;
      this.listeners.forEach((f) => f(e as StudioEvent));
    };
    ws.onclose = () => this.drop(ws);
  }
}

export function studioSocketUrl(loc: Location = window.location): string {
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}/api/ws`;
}

let shared: StudioSocket | undefined;

export function getSocket(): StudioSocket {
  if (!shared) {
    const s = new StudioSocket(studioSocketUrl());
    shared = s;
    s.start();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") s.wake();
    });
    window.addEventListener("online", () => s.wake());
  }
  return shared;
}
