import path from "node:path";
import type { ProjectConfig } from "./config.js";
import { checkRelPath, createProjectFile, FileError, readProjectFile, writeProjectFile } from "./files.js";
import { scanImageCalls, stringEnd, typstString, unescapeString, type ScannedCall } from "./scan.js";

// 画像 API（spec 4.4 / 4.5 / 4.7 段階 2）。オフセット・列は JavaScript の文字列の位置（UTF-16）

export interface ImageCall {
  path: string;
  start: number;
  end: number;
  // start の位置（1 始まり）
  line: number;
  column: number;
  src: string | null;
  resolved: string | null;
  editable: boolean;
  width: string | null;
  height: string | null;
  alt: string | null;
  nearest?: boolean;
}

export const SET_KEYS = ["width", "height", "alt"] as const;
type SetKey = (typeof SET_KEYS)[number];
const SIZE_VALUE_RE = /^\d+(\.\d+)?(%|mm|cm|pt|em|in)$/;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// 各行の先頭の位置
export function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) out.push(i + 1);
  return out;
}

// 位置 → 行（0 始まり）
export function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// 画像のパスを .typ のある場所から解決する（/ で始まればリポジトリのルートから）。外へ出るものは null
export function resolveImagePath(typPath: string, src: string): string | null {
  if (src === "" || src.includes("\0")) return null;
  const p = src.startsWith("/") ? path.posix.normalize(src.slice(1)) : path.posix.normalize(path.posix.join(path.posix.dirname(typPath), src));
  if (p === "." || p === ".." || p.startsWith("../") || path.posix.isAbsolute(p)) return null;
  return p;
}

function toImageCall(text: string, typPath: string, starts: number[], c: ScannedCall): ImageCall {
  const valueOf = (name: string) => {
    const a = c.args.find((x) => x.name === name);
    return a ? text.slice(a.valueStart, a.valueEnd) : null;
  };
  const first = c.args.find((a) => a.name === null && !a.spread);
  const literal = first !== undefined && text[first.valueStart] === '"' && stringEnd(text, first.valueStart) === first.valueEnd;
  const src = literal ? unescapeString(text.slice(first.valueStart, first.valueEnd)) : null;
  const altRaw = valueOf("alt");
  const altIsLiteral = altRaw !== null && altRaw.startsWith('"') && stringEnd(altRaw, 0) === altRaw.length;
  const line = lineOf(starts, c.start);
  return {
    path: typPath,
    start: c.start,
    end: c.end,
    line: line + 1,
    column: c.start - starts[line] + 1,
    src,
    resolved: src === null ? null : resolveImagePath(typPath, src),
    // 閉じていない呼び出しは書き換えない
    editable: literal && text[c.argsClose] === ")",
    width: valueOf("width"),
    height: valueOf("height"),
    alt: altRaw === null ? null : altIsLiteral ? unescapeString(altRaw) : altRaw,
  };
}

export function imageCalls(text: string, typPath: string): ImageCall[] {
  const starts = lineStarts(text);
  return scanImageCalls(text).map((c) => toImageCall(text, typPath, starts, c));
}

// 位置（UTF-16）に当たる呼び出し。無ければ、同じ行か前後 3 行以内の最も近い呼び出しに nearest を付けて返す
export function findImageCallAt(text: string, calls: ImageCall[], offset: number): ImageCall | undefined {
  const hit = calls.filter((c) => c.start <= offset && offset < c.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  if (hit) return hit;
  const starts = lineStarts(text);
  const line = lineOf(starts, offset);
  let best: { c: ImageCall; lines: number; dist: number } | undefined;
  for (const c of calls) {
    const l0 = c.line - 1;
    const l1 = lineOf(starts, Math.max(c.start, c.end - 1));
    const lines = line < l0 ? l0 - line : line > l1 ? line - l1 : 0;
    if (lines > 3) continue;
    const dist = offset < c.start ? c.start - offset : offset - c.end + 1;
    if (!best || lines < best.lines || (lines === best.lines && dist < best.dist)) best = { c, lines, dist };
  }
  return best && { ...best.c, nearest: true };
}

function checkTypPath(rel: unknown): string {
  const p = checkRelPath(rel);
  if (!p.endsWith(".typ")) throw new FileError(400, `"${p}" is not a .typ file`);
  return p;
}

export function listImages(root: string, relIn: unknown): { rev: string; calls: ImageCall[] } {
  const rel = checkTypPath(relIn);
  const f = readProjectFile(root, rel);
  return { rev: f.rev, calls: imageCalls(f.content, rel) };
}

export type ImageSet = Partial<Record<SetKey, string | null>>;

function checkSet(v: unknown): ImageSet {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new FileError(400, '"set" (object) is required');
  const out: ImageSet = {};
  for (const [k, x] of Object.entries(v)) {
    if (!(SET_KEYS as readonly string[]).includes(k)) throw new FileError(400, `"set.${k}" is not supported (width, height, alt)`);
    if (x !== null && typeof x !== "string") throw new FileError(400, `"set.${k}" must be a string or null`);
    if (x !== null && k !== "alt" && !SIZE_VALUE_RE.test(x)) throw new FileError(400, `"set.${k}" must look like "70%" or "32mm"`);
    out[k as SetKey] = x;
  }
  return out;
}

// start の呼び出しの引数だけを書き換えた内容
export function editImageCall(text: string, typPath: string, start: number, set: ImageSet): { content: string; call: ImageCall } {
  const find = (t: string) => {
    const c = scanImageCalls(t).find((x) => x.start === start);
    if (!c || !toImageCall(t, typPath, lineStarts(t), c).editable) {
      throw new FileError(422, `no editable image() call starts at offset ${start}`);
    }
    return c;
  };
  let t = text;
  find(t);
  for (const key of SET_KEYS) {
    if (!(key in set)) continue;
    const v = set[key];
    const c = find(t);
    const idx = c.args.findIndex((a) => a.name === key);
    if (v === null || v === undefined) {
      if (idx < 0) continue;
      // 後ろに引数があれば次の引数の先頭まで、最後なら前の引数の末尾から消す（区切りの , ごと）
      const [from, to] = idx < c.args.length - 1 ? [c.args[idx].start, c.args[idx + 1].start] : [c.args[idx - 1].end, c.args[idx].end];
      t = t.slice(0, from) + t.slice(to);
      continue;
    }
    const lit = key === "alt" ? typstString(v) : v;
    if (idx >= 0) {
      const a = c.args[idx];
      t = t.slice(0, a.valueStart) + lit + t.slice(a.valueEnd);
    } else {
      const last = c.args[c.args.length - 1];
      t = t.slice(0, last.end) + `, ${key}: ${lit}` + t.slice(last.end);
    }
  }
  const c = find(t);
  return { content: t, call: toImageCall(t, typPath, lineStarts(t), c) };
}

export async function patchImage(
  root: string,
  body: { path?: unknown; baseRev?: unknown; start?: unknown; set?: unknown; dryRun?: unknown },
): Promise<{ content: string; call: ImageCall } | { rev: string; call: ImageCall }> {
  const rel = checkTypPath(body.path);
  const { baseRev, start, dryRun } = body;
  if (typeof baseRev !== "string") throw new FileError(400, '"baseRev" (string) is required');
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0) throw new FileError(400, '"start" (integer >= 0) is required');
  if (dryRun !== undefined && typeof dryRun !== "boolean") throw new FileError(400, '"dryRun" must be a boolean');
  const set = checkSet(body.set);
  const cur = readProjectFile(root, rel);
  if (cur.rev !== baseRev) throw new FileError(409, `"${rel}" was changed on disk`, { rev: cur.rev, content: cur.content });
  const r = editImageCall(cur.content, rel, start, set);
  if (dryRun) return r;
  // 読んでから書くまでの変更は writeProjectFile の baseRev の確認が 409 にする
  const { rev } = await writeProjectFile(root, { path: rel, content: r.content, baseRev });
  return { rev, call: r.call };
}

// GET /raw で返すもの
export const RAW_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  gif: "image/gif",
  pdf: "application/pdf",
};

export function rawType(rel: string): string {
  const t = RAW_TYPES[path.posix.extname(rel).slice(1).toLowerCase()];
  if (!t) throw new FileError(415, `"${rel}" is not an image or PDF`);
  return t;
}

// アップロードを受け付ける拡張子と、中身の形式
const UPLOAD_KINDS: Record<string, "png" | "jpeg" | "webp" | "svg"> = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp", svg: "svg" };

// 中身（マジックナンバー）から形式を判定する
export function sniffImage(buf: Buffer): "png" | "jpeg" | "webp" | "svg" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  const head = buf.subarray(0, 4096).toString("utf8").replace(/^﻿/, "");
  if (/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(head)) return "svg";
  return null;
}

// 元のファイル名 → 小文字英数とハイフンの名前と、拡張子
export function normalizeUploadName(name: string): { stem: string; ext: string } {
  const base = name.split(/[\\/]/).pop() ?? "";
  const ext = path.posix.extname(base).slice(1).toLowerCase();
  if (!Object.hasOwn(UPLOAD_KINDS, ext)) throw new FileError(415, `"${base}": only png / jpeg / webp / svg can be uploaded`);
  const stem =
    base
      .slice(0, base.length - ext.length - 1)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .replace(/-+$/, "") || "image";
  return { stem, ext };
}

// spec 4.5。送り先は記事ディレクトリ相対の articles.upload_dir（無ければ images/）
// article は checkArticle で確かめたもの
export async function uploadImage(
  project: ProjectConfig,
  article: string,
  name: unknown,
  buf: unknown,
): Promise<{ path: string; insert: string }> {
  if (typeof name !== "string" || name === "") throw new FileError(400, '"name" (query) is required');
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new FileError(400, "the request body must be the file contents");
  if (buf.length > MAX_UPLOAD_BYTES) throw new FileError(413, `the file is larger than ${MAX_UPLOAD_BYTES} bytes`);
  const { stem, ext } = normalizeUploadName(name);
  const kind = sniffImage(buf);
  if (kind !== UPLOAD_KINDS[ext]) throw new FileError(415, `the contents (${kind ?? "unknown"}) do not match the extension .${ext}`);
  const articleDir = path.posix.dirname(article);
  const dir = path.posix.normalize(path.posix.join(articleDir, project.articles.uploadDir ?? "images"));
  for (let n = 1; n <= 1000; n++) {
    const rel = checkRelPath(path.posix.join(dir, `${n === 1 ? stem : `${stem}-${n}`}.${ext}`));
    if (await createProjectFile(project.root, rel, buf)) {
      const fromArticle = path.posix.relative(articleDir, rel);
      return { path: rel, insert: `#image(${typstString(fromArticle)}, width: 100%)` };
    }
  }
  throw new FileError(409, `too many files named "${stem}.${ext}"`);
}
