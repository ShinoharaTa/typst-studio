import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../api/client";
import { DocSession, type DocIO, type DocSnapshot } from "./doc-session";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(disk = { content: "a", rev: "r0" }) {
  let editor = "";
  const writes: { content: string; baseRev: string | null }[] = [];
  const io: DocIO = {
    read: vi.fn(async () => ({ ...disk })),
    write: vi.fn(async (content: string, baseRev: string | null) => {
      writes.push({ content, baseRev });
      if (baseRev !== disk.rev) throw new ConflictError("rev mismatch", disk.rev, disk.content, {});
      disk = { content, rev: `r${writes.length}` };
      return { rev: disk.rev };
    }),
  };
  const states: DocSnapshot[] = [];
  const reloads: string[] = [];
  const s = new DocSession(
    io,
    () => editor,
    (x) => states.push(x),
    (c) => {
      reloads.push(c);
      editor = c;
    },
  );
  return {
    s,
    io,
    writes,
    states,
    reloads,
    type: (t: string) => {
      editor = t;
      s.edited();
    },
    setDisk: (d: { content: string; rev: string }) => (disk = d),
    // 開いて、エディタに入れる
    open: async () => (editor = await s.load()),
    editor: () => editor,
  };
}

describe("DocSession", () => {
  it("autosaves 2 seconds after typing stops, with the rev it opened", async () => {
    const t = setup();
    expect(await t.open()).toBe("a");
    t.type("ab");
    await vi.advanceTimersByTimeAsync(1500);
    t.type("abc");
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.writes).toEqual([{ content: "abc", baseRev: "r0" }]);
    expect(t.s.rev).toBe("r1");
    expect(t.s.snapshot.state).toBe("clean");
  });

  it("does not save when the text is back to what is on disk", async () => {
    const t = setup();
    await t.open();
    t.type("ab");
    t.type("a");
    expect(t.s.snapshot.state).toBe("clean");
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.writes).toEqual([]);
  });

  it("saves again when typing continued during a save", async () => {
    const t = setup();
    await t.open();
    t.type("ab");
    const p = t.s.save();
    t.type("abc"); // 保存中の入力
    await p;
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.writes.map((w) => w.content)).toEqual(["ab", "abc"]);
    expect(t.writes[1].baseRev).toBe("r1");
    expect(t.s.snapshot.state).toBe("clean");
  });

  it("reports a conflict and can reload from disk", async () => {
    const t = setup();
    await t.open();
    t.setDisk({ content: "changed elsewhere", rev: "rX" });
    t.type("mine");
    await t.s.save();
    expect(t.s.snapshot.state).toBe("conflict");
    expect(t.s.snapshot.conflict).toEqual({ rev: "rX", content: "changed elsewhere" });
    // 衝突中は自動保存しない
    t.type("mine2");
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.writes).toHaveLength(1);
    expect(t.s.resolveReload()).toBe("changed elsewhere");
    expect(t.s.rev).toBe("rX");
    expect(t.s.snapshot.state).toBe("clean");
  });

  it("can overwrite after a conflict", async () => {
    const t = setup();
    await t.open();
    t.setDisk({ content: "changed elsewhere", rev: "rX" });
    t.type("mine");
    await t.s.save();
    await t.s.resolveOverwrite();
    expect(t.writes.at(-1)).toEqual({ content: "mine", baseRev: "rX" });
    expect(t.s.snapshot.state).toBe("clean");
  });

  it("reloads on an external change when there are no edits", async () => {
    const t = setup();
    await t.open();
    t.setDisk({ content: "from LLM", rev: "rL" });
    await t.s.external("rL");
    expect(t.reloads).toEqual(["from LLM"]);
    expect(t.s.rev).toBe("rL");
    // 自分の保存の通知（同じ rev）は無視する
    await t.s.external("rL");
    expect(t.reloads).toHaveLength(1);
  });

  it("keeps edits on an external change and flags it instead", async () => {
    const t = setup();
    await t.open();
    t.type("mine");
    t.setDisk({ content: "from LLM", rev: "rL" });
    await t.s.external("rL");
    expect(t.reloads).toEqual([]);
    expect(t.s.snapshot.diskChanged).toBe(true);
    expect(t.editor()).toBe("mine");
  });

  it("handles an external change that arrives during its own save", async () => {
    const t = setup();
    await t.open();
    t.type("mine");
    const p = t.s.save();
    // 自分の保存で起きた通知（rev は保存後のもの）
    void t.s.external("r1");
    await p;
    expect(t.reloads).toEqual([]);
    expect(t.s.snapshot.state).toBe("clean");
  });

  it("does not save anything before the file is loaded", async () => {
    const t = setup();
    t.type("left over from the previous file");
    await t.s.save();
    await t.s.flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.writes).toEqual([]);
    await t.s.external("rZ");
    expect(t.io.read).not.toHaveBeenCalled();
  });

  it("keeps writing the content it had when disposed", async () => {
    const t = setup();
    await t.open();
    t.type("before switch");
    const p = t.s.flush();
    t.s.dispose();
    t.type("other file");
    await p;
    expect(t.writes).toEqual([{ content: "before switch", baseRev: "r0" }]);
  });
});
