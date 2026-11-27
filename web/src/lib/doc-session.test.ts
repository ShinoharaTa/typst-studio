import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ConflictError } from "../api/client";
import { DocSession, type DocIO, type DocSnapshot } from "./doc-session";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Disk = { content: string; rev: string } | null;

function setup(initial: Disk = { content: "a", rev: "r0" }) {
  let disk: Disk = initial;
  let failNext: Error | null = null;
  const writes: { content: string; baseRev: string | null; keepalive?: boolean }[] = [];
  // 書き込みを止めておける（応答より先に通知が届く順序を作る）
  let gate: Promise<void> | null = null;
  const io: DocIO = {
    read: vi.fn(async () => {
      if (!disk) throw new ApiError(404, "not found");
      return { ...disk };
    }),
    write: vi.fn(async (content: string, baseRev: string | null, opts?: { keepalive?: boolean }) => {
      writes.push({ content, baseRev, keepalive: opts?.keepalive });
      if (gate) await gate;
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      const cur = disk?.rev ?? null;
      if (baseRev !== cur) throw new ConflictError("rev mismatch", cur, disk?.content ?? null, {});
      disk = { content, rev: `r${writes.length}` };
      return { rev: disk.rev };
    }),
  };
  const states: DocSnapshot[] = [];
  const reloads: string[] = [];
  const saved: boolean[] = [];
  const s = new DocSession(
    io,
    (x) => states.push(x),
    (c) => reloads.push(c),
    { onSaved: (clean) => saved.push(clean) },
  );
  return {
    s,
    io,
    writes,
    reloads,
    saved,
    type: (t: string) => s.edited(t),
    setDisk: (d: Disk) => (disk = d),
    failNext: (e: Error) => (failNext = e),
    hold: () => {
      let release!: () => void;
      gate = new Promise((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
  };
}

describe("DocSession", () => {
  it("autosaves 2 seconds after typing stops, with the rev it opened", async () => {
    const t = setup();
    expect(await t.s.load()).toBe("a");
    t.type("ab");
    await vi.advanceTimersByTimeAsync(1500);
    t.type("abc");
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.writes).toEqual([{ content: "abc", baseRev: "r0" }]);
    expect(t.s.rev).toBe("r1");
    expect(t.s.snapshot.state).toBe("clean");
    expect(t.saved).toEqual([true]);
  });

  it("does not save when the text is back to what is on disk", async () => {
    const t = setup();
    await t.s.load();
    t.type("ab");
    t.type("a");
    expect(t.s.snapshot.state).toBe("clean");
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.writes).toEqual([]);
  });

  it("saves again when typing continued during a save", async () => {
    const t = setup();
    await t.s.load();
    t.type("ab");
    const p = t.s.save();
    t.type("abc"); // 保存中の入力
    await p;
    expect(t.saved).toEqual([false]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.writes.map((w) => w.content)).toEqual(["ab", "abc"]);
    expect(t.writes[1].baseRev).toBe("r1");
    expect(t.s.snapshot.state).toBe("clean");
  });

  it("restarts autosave when its own file-changed arrives before the PUT response while typing", async () => {
    const t = setup();
    await t.s.load();
    t.type("ab");
    const release = t.hold();
    const p = t.s.save();
    t.type("abc");
    // 自分の保存の通知（rev は保存後のもの）が応答より先に届く
    void t.s.external("r1");
    release();
    await p;
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.writes.map((w) => w.content)).toEqual(["ab", "abc"]);
    expect(t.s.snapshot.state).toBe("clean");
    expect(t.s.snapshot.diskChanged).toBe(false);
  });

  it("ignores late notifications of its own earlier saves", async () => {
    const t = setup();
    await t.s.load();
    t.type("ab");
    await t.s.save(); // r1
    t.type("abc");
    await t.s.save(); // r2
    t.type("abcd");
    await t.s.external("r1"); // 遅れて届いた 1 回目の通知
    expect(t.s.snapshot.diskChanged).toBe(false);
    expect(t.reloads).toEqual([]);
  });

  it("reports a conflict, stops autosaving, and can reload from disk", async () => {
    const t = setup();
    await t.s.load();
    t.setDisk({ content: "changed elsewhere", rev: "rX" });
    t.type("mine");
    expect(await t.s.save()).toBe(false);
    expect(t.s.snapshot.state).toBe("conflict");
    expect(t.s.snapshot.conflict).toEqual({ rev: "rX", content: "changed elsewhere" });
    t.type("mine2");
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.writes).toHaveLength(1);
    expect(t.s.resolveReload()).toBe("changed elsewhere");
    expect(t.s.rev).toBe("rX");
    expect(t.s.text).toBe("changed elsewhere");
    expect(t.s.snapshot.state).toBe("clean");
  });

  it("can overwrite after a conflict", async () => {
    const t = setup();
    await t.s.load();
    t.setDisk({ content: "changed elsewhere", rev: "rX" });
    t.type("mine");
    await t.s.save();
    expect(await t.s.resolveOverwrite()).toBe(true);
    expect(t.writes.at(-1)).toEqual({ content: "mine", baseRev: "rX" });
    expect(t.s.snapshot.state).toBe("clean");
  });

  it("a removed file conflicts once (no retry loop) and can be recreated", async () => {
    const t = setup();
    await t.s.load();
    t.setDisk(null);
    t.s.removedOnDisk();
    expect(t.s.snapshot.removed).toBe(true);
    t.type("mine");
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.s.snapshot.state).toBe("conflict");
    expect(t.s.snapshot.conflict).toEqual({ rev: null, content: null });
    expect(t.s.resolveReload()).toBeNull();
    t.type("mine2");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.writes).toHaveLength(1);
    expect(await t.s.resolveOverwrite()).toBe(true);
    expect(t.writes.at(-1)).toEqual({ content: "mine2", baseRev: null });
  });

  it("an unreadable file on disk can only be overwritten or discarded", async () => {
    const t = setup();
    await t.s.load();
    t.type("mine");
    t.failNext(new ConflictError("changed", "rBig", null, {}));
    await t.s.save();
    expect(t.s.resolveReload()).toBeNull();
    t.s.discard();
    expect(t.s.safe).toBe(true);
    expect(t.s.snapshot.state).toBe("clean");
  });

  it("flush reports failures so navigation can be stopped", async () => {
    const t = setup();
    await t.s.load();
    t.type("mine");
    t.failNext(new Error("network down"));
    expect(await t.s.flush()).toBe(false);
    expect(t.s.snapshot.state).toBe("error");
    // 回線が戻れば次の flush で保存できる
    expect(await t.s.flush()).toBe(true);
    expect(t.s.snapshot.state).toBe("clean");
  });

  it("passes keepalive through", async () => {
    const t = setup();
    await t.s.load();
    t.type("x");
    await t.s.flush({ keepalive: true });
    expect(t.writes[0].keepalive).toBe(true);
  });

  it("reloads on an external change when there are no edits", async () => {
    const t = setup();
    await t.s.load();
    t.setDisk({ content: "from LLM", rev: "rL" });
    await t.s.external("rL");
    expect(t.reloads).toEqual(["from LLM"]);
    expect(t.s.rev).toBe("rL");
    await t.s.external("rL");
    expect(t.reloads).toHaveLength(1);
  });

  it("does not throw when the reload after an external change fails", async () => {
    const t = setup();
    await t.s.load();
    t.setDisk(null);
    await expect(t.s.external("rGone")).resolves.toBeUndefined();
  });

  it("keeps edits on an external change and flags it instead", async () => {
    const t = setup();
    await t.s.load();
    t.type("mine");
    t.setDisk({ content: "from LLM", rev: "rL" });
    await t.s.external("rL");
    expect(t.reloads).toEqual([]);
    expect(t.s.snapshot.diskChanged).toBe(true);
    expect(t.s.text).toBe("mine");
  });

  it("does not save anything before the file is loaded", async () => {
    const t = setup();
    t.type("left over from the previous file");
    await t.s.save();
    expect(await t.s.flush()).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.writes).toEqual([]);
    await t.s.external("rZ");
    expect(t.io.read).not.toHaveBeenCalled();
  });

  it("keeps the last content itself, so disposing never writes an empty file", async () => {
    const t = setup();
    await t.s.load();
    // 編集なしで閉じる
    t.s.dispose();
    expect(await t.s.flush()).toBe(true);
    expect(t.writes).toEqual([]);
    // 編集ありで閉じる
    const u = setup();
    await u.s.load();
    u.type("before close");
    const p = u.s.flush();
    u.s.dispose();
    await p;
    expect(u.writes).toEqual([{ content: "before close", baseRev: "r0" }]);
  });
});
