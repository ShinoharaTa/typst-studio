import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { assertBindAllowed } from "./bind.js";

// ホスト側設定（spec 10.3）。今は [server] [auth] [limits] [preview] だけ読む
export interface HostConfig {
  home: string;
  dist: string;
  container: boolean;
  server: { bind: string; port: number; publicUrl?: string };
  auth: { mode: "none" | "tailscale"; allowUsers: string[] };
  limits: { driver: "auto" | "systemd-scope" | "watchdog" | "none"; watchdogIntervalMs: number };
  preview: {
    dataPlanePort: number;
    controlPlanePort: number;
    memoryMax: string;
    cpuQuota: string;
    idleStopMinutes: number;
  };
}

// リポジトリ側設定（spec 2.3）。今は [fonts] [preview] [articles] だけ解釈する
export interface ProjectConfig {
  name: string;
  root: string;
  source: string;
  fonts: { paths: string[]; system: boolean };
  preview: { entry: string; inputs: Record<string, string> };
  articles: {
    glob: string;
    imageDirs?: string[];
    uploadDir?: string;
    override: { match: string; inputs: Record<string, string> }[];
  };
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

const SIZE_RE = /^\d+[KMGT]?$/;
const PERCENT_RE = /^\d+%$/;

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
  checkKeys(raw, ["server", "auth", "limits", "preview"], w);

  const s = table(raw, "server", w);
  checkKeys(s, ["bind", "port", "public_url"], `${w} [server]`);
  const bind = str(s, "bind", `${w} [server]`, "127.0.0.1");
  try {
    assertBindAllowed(bind, ctx.container);
  } catch (e) {
    throw new ConfigError(`${w} [server]: ${(e as Error).message}`);
  }

  const a = table(raw, "auth", w);
  checkKeys(a, ["mode", "allow_users"], `${w} [auth]`);
  // 仮: 既定は "none"。"tailscale"（N1）は後の作業で実装する
  const mode = str(a, "mode", `${w} [auth]`, "none");
  if (mode !== "none" && mode !== "tailscale") throw new ConfigError(`${w} [auth]: unknown mode "${mode}"`);

  const l = table(raw, "limits", w);
  checkKeys(l, ["driver", "watchdog_interval_ms"], `${w} [limits]`);
  const driver = str(l, "driver", `${w} [limits]`, "auto");
  if (!["auto", "systemd-scope", "watchdog", "none"].includes(driver)) {
    throw new ConfigError(`${w} [limits]: unknown driver "${driver}"`);
  }

  const p = table(raw, "preview", w);
  const pw = `${w} [preview]`;
  checkKeys(p, ["data_plane_port", "control_plane_port", "memory_max", "cpu_quota", "idle_stop_minutes"], pw);
  const memoryMax = str(p, "memory_max", pw, "600M");
  if (!SIZE_RE.test(memoryMax)) throw new ConfigError(`${pw}: "memory_max" must look like "600M"`);
  const cpuQuota = str(p, "cpu_quota", pw, "200%");
  if (!PERCENT_RE.test(cpuQuota)) throw new ConfigError(`${pw}: "cpu_quota" must look like "200%"`);

  return {
    home: ctx.home,
    dist: ctx.dist,
    container: ctx.container,
    server: {
      bind,
      port: port(s, "port", `${w} [server]`, 8796),
      publicUrl: optStr(s, "public_url", `${w} [server]`),
    },
    auth: { mode, allowUsers: strList(a, "allow_users", `${w} [auth]`) ?? [] },
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

// 仮の置き場: $TYPST_STUDIO_HOME/project-overrides/<name>.toml を優先し、無ければ projects/<name>/typst-studio.toml
export function projectConfigPath(host: HostConfig, name: string): string | undefined {
  const override = path.join(host.home, "project-overrides", `${name}.toml`);
  if (fs.existsSync(override)) return override;
  const inRepo = path.join(host.home, "projects", name, "typst-studio.toml");
  if (fs.existsSync(inRepo)) return inRepo;
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
        `(looked for ${path.join(host.home, "project-overrides", `${name}.toml`)} and ${path.join(root, "typst-studio.toml")})`,
    );
  }
  return parseProjectConfig(readToml(source), { name, root, source });
}

export function parseProjectConfig(raw: Table, ctx: { name: string; root: string; source: string }): ProjectConfig {
  const w = ctx.source;
  checkKeys(raw, ["fonts", "preview", "articles"], w);

  const f = table(raw, "fonts", w);
  checkKeys(f, ["paths", "system"], `${w} [fonts]`);
  const fontPaths = strList(f, "paths", `${w} [fonts]`) ?? [];
  for (const p of fontPaths) resolveInside(ctx.root, p, `${w} [fonts]`);

  if (raw.preview === undefined) throw new ConfigError(`${w}: [preview] is required`);
  const p = table(raw, "preview", w);
  checkKeys(p, ["entry", "inputs"], `${w} [preview]`);
  const entry = str(p, "entry", `${w} [preview]`);
  resolveInside(ctx.root, entry, `${w} [preview]`);
  const inputs = strMap(p, "inputs", `${w} [preview]`);
  checkPlaceholders(inputs, `${w} [preview]`);

  if (raw.articles === undefined) throw new ConfigError(`${w}: [articles] is required`);
  const a = table(raw, "articles", w);
  const aw = `${w} [articles]`;
  checkKeys(a, ["glob", "image_dirs", "upload_dir", "override"], aw);
  const glob = str(a, "glob", aw);
  const ov = a.override;
  if (ov !== undefined && (!Array.isArray(ov) || !ov.every(isTable))) {
    throw new ConfigError(`${aw}: "override" must be an array of tables ([[articles.override]])`);
  }
  const override = ((ov as Table[] | undefined) ?? []).map((o, i) => {
    const ow = `${w} [[articles.override]] #${i + 1}`;
    checkKeys(o, ["match", "inputs"], ow);
    const oi = strMap(o, "inputs", ow);
    checkPlaceholders(oi, ow);
    return { match: str(o, "match", ow), inputs: oi };
  });

  return {
    name: ctx.name,
    root: ctx.root,
    source: ctx.source,
    fonts: { paths: fontPaths, system: bool(f, "system", `${w} [fonts]`, true) },
    preview: { entry, inputs },
    articles: {
      glob,
      imageDirs: strList(a, "image_dirs", aw),
      uploadDir: optStr(a, "upload_dir", aw),
      override,
    },
  };
}
