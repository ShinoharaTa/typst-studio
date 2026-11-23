import fs from "node:fs/promises";

// /proc/meminfo の MemAvailable（バイト）
export async function memAvailableBytes(): Promise<number> {
  const text = await fs.readFile("/proc/meminfo", "utf8");
  const m = /^MemAvailable:\s+(\d+) kB$/m.exec(text);
  if (!m) throw new Error("MemAvailable not found in /proc/meminfo");
  return Number(m[1]) * 1024;
}
