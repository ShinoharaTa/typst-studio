import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySync } from "./memory-sync";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(canSend = true) {
  const log: string[] = [];
  const pending: (() => void)[] = [];
  // 送信は手で終わらせる（応答の遅れを作る）
  const io = {
    set: vi.fn((c: string) => {
      log.push(`set:${c}`);
      return new Promise<void>((r) => pending.push(r));
    }),
    reset: vi.fn(() => {
      log.push("reset");
      return new Promise<void>((r) => pending.push(r));
    }),
    canSend: () => canSend,
  };
  const finish = async () => {
    while (pending.length) {
      pending.shift()!();
      await vi.advanceTimersByTimeAsync(0);
    }
  };
  return { m: new MemorySync(io), io, log, finish };
}

describe("MemorySync", () => {
  it("sends 300ms after typing stops", async () => {
    const t = setup();
    t.m.changed(() => "a");
    await vi.advanceTimersByTimeAsync(200);
    t.m.changed(() => "ab");
    await vi.advanceTimersByTimeAsync(299);
    expect(t.log).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.log).toEqual(["set:ab"]);
  });

  it("sends one at a time and only the latest after the previous finished", async () => {
    const t = setup();
    t.m.changed(() => "1");
    await vi.advanceTimersByTimeAsync(300);
    t.m.changed(() => "2");
    await vi.advanceTimersByTimeAsync(300);
    t.m.changed(() => "3");
    await vi.advanceTimersByTimeAsync(300);
    expect(t.log).toEqual(["set:1"]);
    await t.finish();
    expect(t.log).toEqual(["set:1", "set:3"]);
  });

  it("a reset after a pending set wins (no stale content left in the preview)", async () => {
    const t = setup();
    t.m.changed(() => "1");
    await vi.advanceTimersByTimeAsync(300);
    t.m.changed(() => "2");
    await vi.advanceTimersByTimeAsync(300);
    t.m.reset();
    await t.finish();
    expect(t.log).toEqual(["set:1", "reset"]);
  });

  it("reset cancels a debounced set and is skipped when nothing was sent", async () => {
    const t = setup();
    t.m.changed(() => "1");
    t.m.reset();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.log).toEqual([]);
  });

  it("flush sends the pending content now instead of dropping it", async () => {
    const t = setup();
    t.m.changed(() => "last");
    t.m.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.log).toEqual(["set:last"]);
  });

  it("does not send while the preview is not ours", async () => {
    const t = setup(false);
    t.m.changed(() => "x");
    await vi.advanceTimersByTimeAsync(300);
    expect(t.log).toEqual([]);
  });
});
