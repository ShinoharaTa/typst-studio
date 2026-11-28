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

  it("clears a save error when the text goes back to what is on disk (e.g. undo)", async () => {
    const t = setup();
    await t.s.load();
    t.type("mine");
    t.failNext(new Error("network down"));
    expect(await t.s.flush()).toBe(false);
    expect(t.s.snapshot.state).toBe("error");
    t.type("a"); // 元に戻す
    expect(t.s.snapshot.state).toBe("clean");
    expect(t.s.snapshot.error).toBeUndefined();
    expect(t.s.safe).toBe(true);
    expect(await t.s.flush()).toBe(true);
    expect(t.writes).toHaveLength(1);
  });

  it("clears a save error on save when there is nothing left to save", async () => {
    const t = setup();
    await t.s.load();
    t.type("mine");
    t.failNext(new Error("network down"));
    await t.s.save();
    // 外から入力を戻された（edited を通らない経路）ときも save で解く
    (t.s as unknown as { doc: string }).doc = "a";
    expect(await t.s.save()).toBe(true);
    expect(t.s.snapshot.state).toBe("clean");
  });

  it("keeps a save error through further typing and the retry, until a save succeeds", async () => {
    const t = setup();
    await t.s.load();
    t.type("mine");
    t.failNext(new Error("network down"));
    await t.s.save();
    expect(t.s.snapshot).toMatchObject({ state: "error", error: "network down" });
    // 打つと dirty に戻るが、失敗は残る（画面は失敗の見た目を保つ）
    t.type("mine2");
    expect(t.s.snapshot).toMatchObject({ state: "dirty", error: "network down" });
    const release = t.hold();
    const p = t.s.save();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.s.snapshot).toMatchObject({ state: "saving", error: "network down" });
    release();
    expect(await p).toBe(true);
    expect(t.s.snapshot.state).toBe("clean");
    expect(t.s.snapshot.error).toBeUndefined();
  });

  it("drops an earlier save error when a conflict is resolved by reloading or discarding", async () => {
    for (const how of ["reload", "discard"] as const) {
      const t = setup();
      await t.s.load();
      t.type("mine");
      t.failNext(new Error("network down"));
      await t.s.save();
      t.failNext(new ConflictError("changed", how === "reload" ? "rX" : "rBig", how === "reload" ? "other" : null, {}));
      await t.s.save();
      expect(t.s.snapshot).toMatchObject({ state: "conflict", error: "network down" });
      if (how === "reload") expect(t.s.resolveReload()).toBe("other");
      else t.s.discard();
      expect(t.s.snapshot.state, how).toBe("clean");
      expect(t.s.snapshot.error, how).toBeUndefined();
    }
  });

  it("drops an earlier save error when overwriting a disk that already holds the same text", async () => {
    const t = setup();
    await t.s.load();
    t.type("mine");
    t.failNext(new Error("network down"));
    await t.s.save();
    t.failNext(new ConflictError("changed", "rX", "mine", {}));
    await t.s.save();
    expect(t.s.snapshot).toMatchObject({ state: "conflict", error: "network down" });
    expect(await t.s.resolveOverwrite()).toBe(true);
    expect(t.s.snapshot.state).toBe("clean");
    expect(t.s.snapshot.error).toBeUndefined();
  });

  it("never runs two writes at once, even when an earlier save's cleanup finishes late", async () => {
    let disk = { content: "a", rev: "r0" };
    let inFlight = 0;
    let maxInFlight = 0;
    let n = 0;
    const gates: (() => void)[] = [];
    let holdRead: Promise<void> | null = null;
    const s = new DocSession(
      {
        read: async () => {
          if (holdRead) await holdRead;
          return { ...disk };
        },
        write: async (content, baseRev) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise<void>((r) => gates.push(r));
          inFlight--;
          if (baseRev !== disk.rev) throw new ConflictError("x", disk.rev, disk.content, {});
          disk = { content, rev: `w${++n}` };
          return { rev: disk.rev };
        },
      },
      () => undefined,
      () => undefined,
    );
    const step = () => vi.advanceTimersByTimeAsync(0);
    await s.load();
    s.edited("ab");
    const p1 = s.save();
    await step();
    void s.external("rForeign"); // 保存中に届いた外部の変更
    let releaseRead!: () => void;
    holdRead = new Promise((r) => (releaseRead = r));
    gates.shift()!(); // 1 回目の書き込みが終わる → 外部の変更を読みに行って止まる
    await step();
    s.edited("abc");
    const p2 = s.save(); // 2 回目が始まる
    await step();
    holdRead = null;
    releaseRead(); // 1 回目の後始末が終わる
    await p1;
    s.edited("abcd");
    const p3 = s.save(); // 2 回目の途中なので待ちに回るはず
    await step();
    expect(maxInFlight).toBe(1);
    while (gates.length) {
      gates.shift()!();
      await step();
    }
    await Promise.all([p2, p3]);
    expect(maxInFlight).toBe(1);
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
