import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PING_INTERVAL_MS, PONG_TIMEOUT_MS, StudioSocket, type SocketLike } from "./ws";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  fail() {
    this.readyState = 3;
    this.onclose?.({});
  }
  msg(o: unknown) {
    this.onmessage?.({ data: JSON.stringify(o) });
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const s = new StudioSocket("ws://x/api/ws", () => {
    const f = new FakeSocket();
    sockets.push(f);
    return f;
  });
  const reconnects = vi.fn();
  const events: unknown[] = [];
  s.onReconnect(reconnects);
  s.on((e) => events.push(e));
  s.start();
  return { s, sockets, reconnects, events, last: () => sockets[sockets.length - 1] };
}

describe("StudioSocket", () => {
  it("does not ask for a refetch on the first successful connection", () => {
    const t = setup();
    t.last().open();
    expect(t.reconnects).not.toHaveBeenCalled();
    t.last().msg({ type: "articles-changed", project: "p" });
    expect(t.events).toEqual([{ type: "articles-changed", project: "p" }]);
  });

  it("asks for a refetch when it connects after the first attempt failed", async () => {
    const t = setup();
    t.last().fail();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sockets).toHaveLength(2);
    t.last().open();
    expect(t.reconnects).toHaveBeenCalledTimes(1);
  });

  it("detects a half-open connection with ping / pong and reconnects", async () => {
    const t = setup();
    const first = t.last();
    first.open();
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(first.sent).toEqual(["ping"]);
    first.msg({ type: "pong" });
    await vi.advanceTimersByTimeAsync(PONG_TIMEOUT_MS);
    expect(first.closed).toBe(false);
    expect(t.events).toEqual([]); // pong は通知に流さない
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(first.sent).toEqual(["ping", "ping"]);
    // 返事が無い
    await vi.advanceTimersByTimeAsync(PONG_TIMEOUT_MS);
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sockets).toHaveLength(2);
    t.last().open();
    expect(t.reconnects).toHaveBeenCalledTimes(1);
  });

  it("wake reconnects at once instead of waiting for the backoff", async () => {
    const t = setup();
    t.last().fail();
    await vi.advanceTimersByTimeAsync(1000);
    t.last().fail(); // 次は 2 秒待ち
    await vi.advanceTimersByTimeAsync(500);
    expect(t.sockets).toHaveLength(2);
    t.s.wake();
    expect(t.sockets).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.sockets).toHaveLength(3); // 待っていた分は取り消した
  });

  it("wake on an open connection checks it with a ping", () => {
    const t = setup();
    t.last().open();
    t.s.wake();
    expect(t.last().sent).toEqual(["ping"]);
  });
});
