import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { assertBindAllowed } from "./bind.js";

// ホスト側設定（spec 10.3）
export interface HostConfig {
  home: string;
  dist: string;
  container: boolean;
  // allowedOrigins: 状態を変える API の Origin 検査で許す値。public_url から導出する（spec 7.3）
  server: { bind: string; port: number; publicUrl?: string; allowedOrigins: string[] };
  auth: { mode: "none" | "tailscale"; allowUsers: string[] };
  limits: { driver: "auto" | "systemd-scope" | "watchdog" | "none"; watchdogIntervalMs: number };
  preview: {
    dataPlanePort: number;
    controlPlanePort: number;
    memoryMax: string;
    cpuQuota: string;
    idleStopMinutes: number;
  };
  build: {
    memoryMax: string;
    timeoutSeconds: number;
    autoOnSave: boolean;
    autoDebounceSeconds: number;
    keepGenerations: number;
  };
  // extraPaths: $TYPST_STUDIO_DIST 相対で書き、絶対パスにして持つ
  fonts: { extraPaths: string[] };
}

export interface ProfileConfig {
  entry: string;
  inputs: Record<string, string>;
  output: string;
}

// リポジトリ側設定（spec 2.3）
export interface ProjectConfig {
  name: string;
  root: string;
  source: string;
  project: { name?: string; typst: string };
  fonts: { paths: string[]; system: boolean };
  book: { entry: string; previewProfile?: string };
  // [preview] が無ければ book.entry をそのまま使う（inputs は空）
  preview: { entry: string; inputs: Record<string, string> };
  articles: {
    glob: string;
    imageDirs?: string[];
    uploadDir?: string;
    override: { match: string; inputs: Record<string, string> }[];
  };
  profiles: Record<string, ProfileConfig>;
  imageFn: { name: string; pathArg: number; sizeArgs: Record<string, number> }[];
}

export class ConfigError extends Error {}

type Table = Record<string, unknown>;

function isTable(v: unknown): v is Table {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function checkKeys(t: Table, allowed: string[], where: string): void {
  for (const k of Object.keys(t)) {
    if (!allowed.includes(k)) throw new ConfigError(`${where}: unknown key "${k}"`);
  }
}

function table(t: Table, key: string, where: string): Table {
  const v = t[key];
  if (v === undefined) return {};
  if (!isTable(v)) throw new ConfigError(`${where}: [${key}] must be a table`);
  return v;
}

function str(t: Table, key: string, where: string, def?: string): string {
  const v = t[key];
  if (v === undefined) {
    if (def === undefined) throw new ConfigError(`${where}: "${key}" is required`);
    return def;
  }
  if (typeof v !== "string") throw new ConfigError(`${where}: "${key}" must be a string`);
  return v;
}

function optStr(t: Table, key: string, where: string): string | undefined {
  return t[key] === undefined ? undefined : str(t, key, where);
}

function bool(t: Table, key: string, where: string, def: boolean): boolean {
  const v = t[key];
  if (v === undefined) return def;
  if (typeof v !== "boolean") throw new ConfigError(`${where}: "${key}" must be a boolean`);
  return v;
}

function num(t: Table, key: string, where: string, def: number): number {
  const v = t[key];
  if (v === undefined) return def;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    throw new ConfigError(`${where}: "${key}" must be a positive number`);
  }
  return v;
}

function int(t: Table, key: string, where: string, min: number, def?: number): number {
  const v = t[key];
  if (v === undefined) {
    if (def === undefined) throw new ConfigError(`${where}: "${key}" is required`);
    return def;
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) {
    throw new ConfigError(`${where}: "${key}" must be an integer >= ${min}`);
  }
  return v;
}

function port(t: Table, key: string, where: string, def: number): number {
  const v = num(t, key, where, def);
  if (!Number.isInteger(v) || v > 65535) throw new ConfigError(`${where}: "${key}" must be a port number`);
  return v;
}

function strList(t: Table, key: string, where: string): string[] | undefined {
  const v = t[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new ConfigError(`${where}: "${key}" must be an array of strings`);
  }
  return v;
}

function strMap(t: Table, key: string, where: string): Record<string, string> {
  const v = t[key];
  if (v === undefined) return {};
  if (!isTable(v) || !Object.values(v).every((x) => typeof x === "string")) {
    throw new ConfigError(`${where}: "${key}" must be a table of strings`);
  }
  return v as Record<string, string>;
}

function readToml(file: string): Table {
  try {
    return parseToml(fs.readFileSync(file, "utf8")) as Table;
  } catch (e) {
    throw new ConfigError(`${file}: ${(e as Error).message}`);
  }
}

function arrayOfTables(t: Table, key: string, where: string, label: string): Table[] {
  const v = t[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every(isTable)) throw new ConfigError(`${where}: "${key}" must be an array of tables (${label})`);
  return v;
}

const SIZE_RE = /^\d+[KMGT]?$/;
const PERCENT_RE = /^\d+%$/;

function size(t: Table, key: string, where: string, def: string): string {
  const v = str(t, key, where, def);
  if (!SIZE_RE.test(v)) throw new ConfigError(`${where}: "${key}" must look like "600M"`);
  return v;
}

// "600M" → バイト。systemd と同じく K/M/G/T は 1024 倍
export function parseSize(s: string): number {
  const m = /^(\d+)([KMGT]?)$/.exec(s);
  if (!m) throw new Error(`invalid size "${s}"`);
  const exp = { "": 0, K: 1, M: 2, G: 3, T: 4 }[m[2] as "" | "K" | "M" | "G" | "T"];
  return Number(m[1]) * 1024 ** exp;
}

// 相対パスの形だけを検証する（実在は問わない）。絶対パスと .. を拒否
function relPath(rel: string, where: string): string {
  if (rel === "" || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
    throw new ConfigError(`${where}: "${rel}" must be a relative path without ".."`);
  }
  return rel;
}

export function defaultHome(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "typst-studio");
}

// 優先順位: 環境変数 TYPST_STUDIO_* > config.toml > 既定値
export function loadHostConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const home = path.resolve(env.TYPST_STUDIO_HOME || defaultHome(env));
  const dist = path.resolve(env.TYPST_STUDIO_DIST || home);
  const container = env.TYPST_STUDIO_CONTAINER === "1";
  const file = path.join(home, "config.toml");
  const raw = fs.existsSync(file) ? readToml(file) : {};
  return parseHostConfig(raw, { home, dist, container, where: file });
}

export function parseHostConfig(
  raw: Table,
  ctx: { home: string; dist: string; container: boolean; where: string },
): HostConfig {
  const w = ctx.where;
  checkKeys(raw, ["server", "auth", "limits", "preview", "build", "fonts"], w);

  const s = table(raw, "server", w);
  checkKeys(s, ["bind", "port", "public_url"], `${w} [server]`);
  const bind = str(s, "bind", `${w} [server]`, "127.0.0.1");
  try {
    assertBindAllowed(bind, ctx.container);
  } catch (e) {
    throw new ConfigError(`${w} [server]: ${(e as Error).message}`);
  }

  const publicUrl = optStr(s, "public_url", `${w} [server]`);
  const allowedOrigins: string[] = [];
  if (publicUrl !== undefined) {
    let u: URL;
    try {
      u = new URL(publicUrl);
    } catch {
      throw new ConfigError(`${w} [server]: "public_url" must be a URL`);
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new ConfigError(`${w} [server]: "public_url" must be http(s)`);
    }
    allowedOrigins.push(u.origin);
  }

  const a = table(raw, "auth", w);
  checkKeys(a, ["mode", "allow_users"], `${w} [auth]`);
  const mode = str(a, "mode", `${w} [auth]`, "tailscale");
  if (mode !== "none" && mode !== "tailscale") throw new ConfigError(`${w} [auth]: unknown mode "${mode}"`);
  const allowUsers = strList(a, "allow_users", `${w} [auth]`) ?? [];
  if (mode === "tailscale" && allowUsers.length === 0) {
    throw new ConfigError(`${w} [auth]: "allow_users" is required when mode = "tailscale" (use mode = "none" for development)`);
  }

  const l = table(raw, "limits", w);
  checkKeys(l, ["driver", "watchdog_interval_ms"], `${w} [limits]`);
  const driver = str(l, "driver", `${w} [limits]`, "auto");
  if (!["auto", "systemd-scope", "watchdog", "none"].includes(driver)) {
    throw new ConfigError(`${w} [limits]: unknown driver "${driver}"`);
  }

  const p = table(raw, "preview", w);
  const pw = `${w} [preview]`;
  checkKeys(p, ["data_plane_port", "control_plane_port", "memory_max", "cpu_quota", "idle_stop_minutes"], pw);
  const memoryMax = size(p, "memory_max", pw, "600M");
  const cpuQuota = str(p, "cpu_quota", pw, "200%");
  if (!PERCENT_RE.test(cpuQuota)) throw new ConfigError(`${pw}: "cpu_quota" must look like "200%"`);

  const b = table(raw, "build", w);
  const bw = `${w} [build]`;
  checkKeys(b, ["memory_max", "timeout_seconds", "auto_on_save", "auto_debounce_seconds", "keep_generations"], bw);

  const f = table(raw, "fonts", w);
  const fw = `${w} [fonts]`;
  checkKeys(f, ["extra_paths"], fw);
  const extraPaths = (strList(f, "extra_paths", fw) ?? ["fonts"]).map((p) => path.join(ctx.dist, relPath(p, fw)));

  return {
    home: ctx.home,
    dist: ctx.dist,
    container: ctx.container,
    server: {
      bind,
      port: port(s, "port", `${w} [server]`, 8796),
      publicUrl,
      allowedOrigins,
    },
    auth: { mode, allowUsers },
    limits: {
      driver: driver as HostConfig["limits"]["driver"],
      watchdogIntervalMs: num(l, "watchdog_interval_ms", `${w} [limits]`, 250),
    },
    preview: {
      dataPlanePort: port(p, "data_plane_port", pw, 23625),
      controlPlanePort: port(p, "control_plane_port", pw, 23626),
      memoryMax,
      cpuQuota,
      idleStopMinutes: num(p, "idle_stop_minutes", pw, 10),
    },
    build: {
      memoryMax: size(b, "memory_max", bw, "1500M"),
      timeoutSeconds: num(b, "timeout_seconds", bw, 300),
      autoOnSave: bool(b, "auto_on_save", bw, true),
      autoDebounceSeconds: num(b, "auto_debounce_seconds", bw, 5),
      keepGenerations: int(b, "keep_generations", bw, 1, 2),
    },
    fonts: { extraPaths },
  };
}

export const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// リポジトリ相対のパスを検証し、絶対パスを返す。外へ出るもの（..・絶対パス・シンボリックリンク越え）は拒否
export function resolveInside(root: string, rel: string, where: string): string {
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
    throw new ConfigError(`${where}: "${rel}" must be a relative path inside the repository`);
  }
  const abs = path.resolve(root, rel);
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    throw new ConfigError(`${where}: "${rel}" does not exist`);
  }
  const realRoot = fs.realpathSync(root);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new ConfigError(`${where}: "${rel}" points outside the repository`);
  }
  return abs;
}

const PLACEHOLDER_RE = /\{([^{}]*)\}/g;

function checkPlaceholders(inputs: Record<string, string>, where: string): void {
  for (const [k, v] of Object.entries(inputs)) {
    for (const m of v.matchAll(PLACEHOLDER_RE)) {
      if (m[1] !== "article_entry") throw new ConfigError(`${where}: inputs.${k} has undefined placeholder {${m[1]}}`);
    }
  }
}

// リポジトリ直下の typst-studio.toml を使い、無ければ $TYPST_STUDIO_HOME/project-overrides/<name>.toml（仮の置き場）
export function projectConfigPath(host: HostConfig, name: string): string | undefined {
  const inRepo = path.join(host.home, "projects", name, "typst-studio.toml");
  if (fs.existsSync(inRepo)) return inRepo;
  const override = path.join(host.home, "project-overrides", `${name}.toml`);
  if (fs.existsSync(override)) return override;
  return undefined;
}

export function loadProjectConfig(host: HostConfig, name: string): ProjectConfig {
  if (!PROJECT_NAME_RE.test(name)) throw new ConfigError(`invalid project name "${name}"`);
  const dir = path.join(host.home, "projects", name);
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new ConfigError(`project "${name}" not found under ${path.join(host.home, "projects")}`);
  }
  // tinymist はカレント（実パス）基準でエントリを解決し、--root の外だと起動しないので実パスにそろえる
  const root = fs.realpathSync(dir);
  const source = projectConfigPath(host, name);
  if (!source) {
    throw new ConfigError(
      `project "${name}" has no typst-studio.toml ` +
        `(looked for ${path.join(root, "typst-studio.toml")} and ${path.join(host.home, "project-overrides", `${name}.toml`)})`,
    );
  }
  return parseProjectConfig(readToml(source), { name, root, source });
}

const VERSION_RE = /^\d+\.\d+\.\d+$/;

export function parseProjectConfig(raw: Table, ctx: { name: string; root: string; source: string }): ProjectConfig {
  const w = ctx.source;
  checkKeys(raw, ["project", "fonts", "book", "preview", "articles", "profiles", "image_fn"], w);

  if (raw.project === undefined) throw new ConfigError(`${w}: [project] is required`);
  const pj = table(raw, "project", w);
  const pjw = `${w} [project]`;
  checkKeys(pj, ["name", "typst"], pjw);
  const typst = str(pj, "typst", pjw);
  if (!VERSION_RE.test(typst)) throw new ConfigError(`${pjw}: "typst" must look like "0.14.2"`);

  const f = table(raw, "fonts", w);
  checkKeys(f, ["paths", "system"], `${w} [fonts]`);
  const fontPaths = strList(f, "paths", `${w} [fonts]`) ?? [];
  for (const p of fontPaths) resolveInside(ctx.root, p, `${w} [fonts]`);

  if (raw.book === undefined) throw new ConfigError(`${w}: [book] is required`);
  const bk = table(raw, "book", w);
  const bkw = `${w} [book]`;
  checkKeys(bk, ["entry", "preview_profile"], bkw);
  const bookEntry = str(bk, "entry", bkw);
  resolveInside(ctx.root, bookEntry, bkw);
  const previewProfile = optStr(bk, "preview_profile", bkw);

  let preview: ProjectConfig["preview"] = { entry: bookEntry, inputs: {} };
  if (raw.preview !== undefined) {
    const p = table(raw, "preview", w);
    checkKeys(p, ["entry", "inputs"], `${w} [preview]`);
    const entry = str(p, "entry", `${w} [preview]`, bookEntry);
    resolveInside(ctx.root, entry, `${w} [preview]`);
    const inputs = strMap(p, "inputs", `${w} [preview]`);
    checkPlaceholders(inputs, `${w} [preview]`);
    preview = { entry, inputs };
  }

  if (raw.articles === undefined) throw new ConfigError(`${w}: [articles] is required`);
  const a = table(raw, "articles", w);
  const aw = `${w} [articles]`;
  checkKeys(a, ["glob", "image_dirs", "upload_dir", "override"], aw);
  const glob = relPath(str(a, "glob", aw), aw);
  const imageDirs = strList(a, "image_dirs", aw)?.map((d) => relPath(d, aw));
  const uploadDir = optStr(a, "upload_dir", aw);
  if (uploadDir !== undefined) relPath(uploadDir, aw);
  const override = arrayOfTables(a, "override", aw, "[[articles.override]]").map((o, i) => {
    const ow = `${w} [[articles.override]] #${i + 1}`;
    checkKeys(o, ["match", "inputs"], ow);
    const oi = strMap(o, "inputs", ow);
    checkPlaceholders(oi, ow);
    return { match: relPath(str(o, "match", ow), ow), inputs: oi };
  });

  const pf = table(raw, "profiles", w);
  const profiles: Record<string, ProfileConfig> = {};
  for (const [pname, v] of Object.entries(pf)) {
    const pfw = `${w} [profiles.${pname}]`;
    if (!isTable(v)) throw new ConfigError(`${pfw}: must be a table`);
    checkKeys(v, ["entry", "inputs", "output"], pfw);
    const entry = str(v, "entry", pfw);
    resolveInside(ctx.root, entry, pfw);
    const inputs = strMap(v, "inputs", pfw);
    checkPlaceholders(inputs, pfw);
    profiles[pname] = { entry, inputs, output: relPath(str(v, "output", pfw), pfw) };
  }
  if (previewProfile !== undefined && !Object.hasOwn(profiles, previewProfile)) {
    throw new ConfigError(`${bkw}: "preview_profile" = "${previewProfile}" is not defined in [profiles.*]`);
  }

  const imageFn = arrayOfTables(raw, "image_fn", w, "[[image_fn]]").map((o, i) => {
    const iw = `${w} [[image_fn]] #${i + 1}`;
    checkKeys(o, ["name", "path_arg", "size_args"], iw);
    const sa = table(o, "size_args", iw);
    const sizeArgs: Record<string, number> = {};
    for (const k of Object.keys(sa)) sizeArgs[k] = int(sa, k, `${iw} size_args`, 0);
    return { name: str(o, "name", iw), pathArg: int(o, "path_arg", iw, 0), sizeArgs };
  });

  return {
    name: ctx.name,
    root: ctx.root,
    source: ctx.source,
    project: { name: optStr(pj, "name", pjw), typst },
    fonts: { paths: fontPaths, system: bool(f, "system", `${w} [fonts]`, true) },
    book: { entry: bookEntry, previewProfile },
    preview,
    articles: { glob, imageDirs, uploadDir, override },
    profiles,
    imageFn,
  };
}
