import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { LaunchSpec } from "../src/limits/driver.js";
import { selectDriver } from "../src/limits/index.js";
import { NoneDriver } from "../src/limits/none.js";
import { WatchdogDriver } from "../src/limits/watchdog.js";

const node = process.execPath;
const spec = (args: string[], limits: Partial<LaunchSpec["limits"]> = {}, command = node): LaunchSpec => ({
  label: "test",
  command,
  args,
  cwd: os.tmpdir(),
  limits: { memoryMax: "100M", ...limits },
});

const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ts-limits-"));
afterAll(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
const stateDir = (name: string) => path.join(stateRoot, name);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ALLOC_FAILED = 'echo "memory allocation of 2097152 bytes failed" >&2; exit 134';

// 50ms ごとに 20MB ずつ確保して保持し続ける
const HOG = "const a=[];setInterval(()=>{const b=Buffer.alloc(20*1024*1024,1);a.push(b)},50)";

describe("watchdog driver", () => {
  const driver = new WatchdogDriver(50, stateDir("watchdog"));

  it("declares watchdog capability", () => {
    expect(driver.name).toBe("watchdog");
    expect(driver.capability).toBe("watchdog");
  });

  it("reports ok / error from the exit code", async () => {
    expect((await (await driver.start(spec(["-e", "0"]))).exited).reason).toBe("ok");
    const e = await (await driver.start(spec(["-e", "process.exit(3)"]))).exited;
    expect(e).toMatchObject({ reason: "error", code: 3 });
  });

  it("kills the process when RSS exceeds memory_max and reports limit", async () => {
    const t0 = Date.now();
    const p = await driver.start(spec(["-e", HOG]));
    const e = await p.exited;
    expect(e.reason).toBe("limit");
    expect(e.signal).toBe("SIGKILL");
    expect(e.detail).toMatch(/RSS \d+MB > 100M/);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("sets nice and oom_score_adj on the child", async () => {
    const p = await driver.start(spec(["-e", "setTimeout(()=>{},5000)"], { nice: 10 }));
    const pid = Number(p.id.split("-").pop());
    await new Promise((r) => setTimeout(r, 100));
    expect(os.getPriority(pid)).toBe(10);
    expect(fs.readFileSync(`/proc/${pid}/oom_score_adj`, "utf8").trim()).toBe("1000");
    expect((await p.stop()).reason).toBe("stopped");
  });

  it("sums RSS over child and grandchild processes", async () => {
    // 1 本ずつは上限未満、合計で上限超え
    const hold = `${node} -e "const b=Buffer.alloc(70*1024*1024,1);setInterval(()=>b[0]++,1000)"`;
    const p = await driver.start(spec(["-c", `${hold} & ${hold} & wait`], { memoryMax: "200M" }, "sh"));
    const e = await p.exited;
    expect(e.reason).toBe("limit");
    expect(e.detail).toMatch(/RSS \d+MB > 200M/);
  });

  it("treats an allocation failure + exit 134 under the address space limit as limit, not error", async () => {
    const p = await driver.start(spec(["-c", ALLOC_FAILED], { addressSpace: true, memoryMax: "900M" }, "sh"));
    const e = await p.exited;
    expect(e.reason).toBe("limit");
    expect(e.detail).toMatch(/address space limit 900M \(exit 134\)/);
  });

  it("treats an allocation failure + SIGABRT under the address space limit as limit", async () => {
    // node は OS のパッケージ外なので、apport はクラッシュレポートを作らない
    const abort = 'console.error("memory allocation of 8 bytes failed"); process.abort()';
    const p = await driver.start(spec(["-e", abort], { addressSpace: true, memoryMax: "64G" }));
    const e = await p.exited;
    expect(e).toMatchObject({ reason: "limit", signal: "SIGABRT" });
    expect(e.detail).toMatch(/address space limit 64G \(SIGABRT\)/);
  });

  it("does not treat an unrelated exit 134 / SIGABRT as limit", async () => {
    const e1 = await (await driver.start(spec(["-c", "exit 134"], { addressSpace: true, memoryMax: "900M" }, "sh"))).exited;
    expect(e1.reason).toBe("error");
    const p = await driver.start(spec(["-e", 'console.error("boom"); process.abort()'], { addressSpace: true, memoryMax: "64G" }));
    expect(await p.exited).toMatchObject({ reason: "error", signal: "SIGABRT" });
  });

  it("applies prlimit --as when addressSpace is set", async () => {
    const p = await driver.start(spec(["-c", "ulimit -v"], { addressSpace: true, memoryMax: "900M" }, "sh"));
    let out = "";
    p.onOutput((_s, c) => (out += c.toString()));
    expect((await p.exited).reason).toBe("ok");
    expect(out.trim()).toBe(String(900 * 1024));
  });

  it("does not treat exit 134 as limit without addressSpace", async () => {
    const e = await (await driver.start(spec(["-c", ALLOC_FAILED], {}, "sh"))).exited;
    expect(e.reason).toBe("error");
  });

  it("stops the whole process group", async () => {
    const p = await driver.start(spec(["-c", "sleep 30 & sleep 30; wait"], {}, "sh"));
    const pgid = Number(p.id.split("-").pop());
    await new Promise((r) => setTimeout(r, 100));
    expect((await p.stop()).reason).toBe("stopped");
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(-pgid, 0)).toThrow(/ESRCH/);
  });

  it("cleans up children left by a previous studio (pid file)", async () => {
    const dir = stateDir("crash");
    const before = new WatchdogDriver(50, dir);
    const p = await before.start(spec(["-c", "sleep 30 & sleep 30; wait"], {}, "sh"));
    const pgid = Number(p.id.split("-").pop());
    expect(fs.readdirSync(dir)).toEqual([`${pgid}.json`]);
    // studio が落ちて、次の studio が同じ置き場で起動した
    const after = new WatchdogDriver(50, dir);
    expect(await after.cleanupStale()).toEqual([`test (pid ${pgid})`]);
    await p.exited;
    await sleep(100);
    expect(() => process.kill(-pgid, 0)).toThrow(/ESRCH/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("does not kill a reused pid when cleaning up", async () => {
    const dir = stateDir("reused");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, startTime: "1", label: "x" }));
    expect(await new WatchdogDriver(50, dir).cleanupStale()).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("removes the record when the child exits", async () => {
    const dir = stateDir("exit");
    await (await new WatchdogDriver(50, dir).start(spec(["-e", "0"]))).exited;
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("reports timeout", async () => {
    const e = await (await driver.start(spec(["-e", "setTimeout(()=>{},10000)"], { timeoutSeconds: 0.2 }))).exited;
    expect(e.reason).toBe("timeout");
  });

  it("returns available memory no larger than MemAvailable", async () => {
    const m = /^MemAvailable:\s+(\d+) kB$/m.exec(fs.readFileSync("/proc/meminfo", "utf8"))!;
    const avail = await driver.availableMemoryBytes();
    expect(avail).toBeGreaterThan(0);
    expect(avail).toBeLessThanOrEqual(Number(m[1]) * 1024 * 1.1);
  });
});

describe("none driver", () => {
  const driver = new NoneDriver(stateDir("none"));

  it("declares no capability and never reports limit", async () => {
    expect(driver.capability).toBe("none");
    const e = await (await driver.start(spec(["-c", ALLOC_FAILED], { addressSpace: true }, "sh"))).exited;
    expect(e.reason).toBe("error");
  });

  it("does not apply prlimit", async () => {
    const p = await driver.start(spec(["-c", "ulimit -v"], { addressSpace: true }, "sh"));
    let out = "";
    p.onOutput((_s, c) => (out += c.toString()));
    await p.exited;
    expect(out.trim()).toBe("unlimited");
  });
});

describe("selectDriver", () => {
  it("returns the configured driver", async () => {
    expect((await selectDriver({ driver: "watchdog", watchdogIntervalMs: 250 }, stateDir("select"))).name).toBe("watchdog");
    expect((await selectDriver({ driver: "none", watchdogIntervalMs: 250 }, stateDir("select"))).name).toBe("none");
    expect((await selectDriver({ driver: "systemd-scope", watchdogIntervalMs: 250 }, stateDir("select"))).name).toBe("systemd-scope");
  });

  it("auto picks systemd-scope or watchdog", async () => {
    expect(["systemd-scope", "watchdog"]).toContain((await selectDriver({ driver: "auto", watchdogIntervalMs: 250 }, stateDir("select"))).name);
  });
});
