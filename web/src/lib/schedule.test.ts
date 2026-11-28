import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoBuild, Debouncer, isBuildInput, LatestOnly } from "./schedule";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Debouncer", () => {
  it("runs once after the input stops", () => {
    const fn = vi.fn();
    const d = new Debouncer(300, fn);
    d.schedule();
    vi.advanceTimersByTime(200);
    d.schedule();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.pending).toBe(false);
  });

  it("flush runs a pending call now, and only if pending", () => {
    const fn = vi.fn();
    const d = new Debouncer(300, fn);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
    d.schedule();
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("AutoBuild", () => {
  it("builds 5 seconds after the last change while the book tab is shown", () => {
    const build = vi.fn();
    const a = new AutoBuild(build);
    a.setActive(true);
    a.notify();
    vi.advanceTimersByTime(3000);
    a.notify(); // 連続保存は 1 回にまとめる
    vi.advanceTimersByTime(4999);
    expect(build).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("ignores changes while the book tab is hidden", () => {
    const build = vi.fn();
    const a = new AutoBuild(build);
    a.notify();
    vi.advanceTimersByTime(10_000);
    expect(build).not.toHaveBeenCalled();
  });

  it("cancels a pending build when the tab is hidden, and does not resume it on return", () => {
    const build = vi.fn();
    const a = new AutoBuild(build);
    a.setActive(true);
    a.notify();
    vi.advanceTimersByTime(2000);
    a.setActive(false);
    expect(a.pending).toBe(false);
    a.setActive(true);
    vi.advanceTimersByTime(10_000);
    expect(build).not.toHaveBeenCalled();
  });

  it("stops after dispose", () => {
    const build = vi.fn();
    const a = new AutoBuild(build, 1000);
    a.setActive(true);
    a.notify();
    a.dispose();
    a.notify();
    vi.advanceTimersByTime(5000);
    expect(build).not.toHaveBeenCalled();
  });
});

describe("isBuildInput", () => {
  it("matches .typ and images only", () => {
    expect(isBuildInput("articles/a/article.typ")).toBe(true);
    expect(isBuildInput("images/x.PNG")).toBe(true);
    expect(isBuildInput("images/x.jpeg")).toBe(true);
    expect(isBuildInput("typst-studio.toml")).toBe(false);
    expect(isBuildInput("notes.md")).toBe(false);
  });
});

describe("LatestOnly", () => {
  it("runs one at a time and skips intermediate values", async () => {
    vi.useRealTimers();
    const seen: number[] = [];
    let release!: () => void;
    const q = new LatestOnly<number>(async (v) => {
      seen.push(v);
      if (v === 1) await new Promise<void>((r) => (release = r));
    });
    q.push(1);
    q.push(2);
    q.push(3);
    q.push(4);
    expect(seen).toEqual([1]);
    release();
    await q.settled();
    expect(seen).toEqual([1, 4]);
  });

  it("keeps going after a failure, and clear drops the pending value", async () => {
    vi.useRealTimers();
    const seen: number[] = [];
    let release!: () => void;
    const q = new LatestOnly<number>(async (v) => {
      seen.push(v);
      if (v === 1) {
        await new Promise<void>((r) => (release = r));
        throw new Error("x");
      }
    });
    q.push(1);
    q.push(2);
    q.clear();
    release();
    await q.settled();
    expect(seen).toEqual([1]);
    q.push(5);
    await q.settled();
    expect(seen).toEqual([1, 5]);
  });
});
