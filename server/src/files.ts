import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ConfigError, PROJECT_NAME_RE, resolveInside, type HostConfig, type ProjectConfig } from "./config.js";

// ファイル API（spec 4.3 / 6.4 / 7.3）。rev = 内容の sha256（hex）

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

// rename 前の一時ファイル。監視はこれを無視する
export const TMP_FILE_RE = /\.typst-studio-\d+-[0-9a-f]+\.tmp$/;

export class FileError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 415,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// プロジェクトのディレクトリ（実パス）。設定が読めなくても返す（壊れた typst-studio.toml を直せるように）
export function projectRoot(host: HostConfig, name: string): string {
  if (!PROJECT_NAME_RE.test(name)) throw new FileError(400, `invalid project name "${name}"`);
  const dir = path.join(host.home, "projects", name);
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new FileError(404, `project "${name}" not found`);
  return fs.realpathSync(dir);
}

const isGitSegment = (s: string) => s.toLowerCase() === ".git";

// API で受け取るリポジトリ相対パスの形を検証する（実在は問わない）
export function checkRelPath(rel: unknown): string {
  if (typeof rel !== "string" || rel === "") throw new FileError(400, '"path" (string) is required');
  if (rel.includes("\0")) throw new FileError(400, "path must not contain NUL");
  if (path.isAbsolute(rel)) throw new FileError(400, `"${rel}" must be a relative path inside the project`);
  const segs = rel.split("/");
  if (segs.includes("..")) throw new FileError(400, `"${rel}" must not contain ".."`);
  if (path.posix.normalize(rel) !== rel || rel.endsWith("/")) throw new FileError(400, `"${rel}" must be a normalized path`);
  if (segs.some(isGitSegment)) throw new FileError(403, `"${rel}" is inside .git/`);
  return rel;
}

function inside(root: string, rel: string, where: string): string {
  try {
    return resolveInside(root, rel, where);
  } catch (e) {
    if (e instanceof ConfigError) throw new FileError(403, e.message);
    throw e;
  }
}

// 実パスに .git が入っていないか（シンボリックリンクで .git/ の中を指すもの）
function checkRealNotGit(root: string, real: string, rel: string): void {
  const r = path.relative(root, real);
  if (r.split(path.sep).some(isGitSegment)) throw new FileError(403, `"${rel}" points inside .git/`);
}

interface Target {
  // 書き込み先の実パス（シンボリックリンクなら指す先）
  real: string;
  exists: boolean;
}

function resolveTarget(root: string, rel: string): Target {
  const abs = path.join(root, rel);
  const lst = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (lst) {
    inside(root, rel, "path");
    const real = fs.realpathSync(abs);
    checkRealNotGit(root, real, rel);
    if (!fs.statSync(real).isFile()) throw new FileError(400, `"${rel}" is not a regular file`);
    return { real, exists: true };
  }
  // 新規: 親ディレクトリは実在し、ルート配下であること（ディレクトリは作らない）
  const parentRel = path.posix.dirname(rel);
  let parent = root;
  if (parentRel !== ".") {
    if (!fs.lstatSync(path.join(root, parentRel), { throwIfNoEntry: false })) {
      throw new FileError(404, `directory "${parentRel}" does not exist`);
    }
    inside(root, parentRel, "path");
    parent = fs.realpathSync(path.join(root, parentRel));
    if (!fs.statSync(parent).isDirectory()) throw new FileError(400, `"${parentRel}" is not a directory`);
    checkRealNotGit(root, parent, rel);
  }
  return { real: path.join(parent, path.posix.basename(rel)), exists: false };
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function decode(buf: Buffer, rel: string): string {
  try {
    return utf8.decode(buf);
  } catch {
    throw new FileError(415, `"${rel}" is not UTF-8 text`);
  }
}

export interface FileContent {
  path: string;
  content: string;
  rev: string;
}

export function readProjectFile(root: string, relIn: unknown): FileContent {
  const rel = checkRelPath(relIn);
  if (!fs.lstatSync(path.join(root, rel), { throwIfNoEntry: false })) throw new FileError(404, `"${rel}" does not exist`);
  const t = resolveTarget(root, rel);
  const size = fs.statSync(t.real).size;
  if (size > MAX_FILE_BYTES) throw new FileError(413, `"${rel}" is larger than ${MAX_FILE_BYTES} bytes`);
  const buf = fs.readFileSync(t.real);
  return { path: rel, content: decode(buf, rel), rev: sha256(buf) };
}

// 同じファイルへの書き込みは studio の中で順に行う（rev の確認から rename までの間に割り込ませない）
const writeQueues = new Map<string, Promise<unknown>>();

function serial<T>(key: string, fn: () => T): Promise<T> {
  const prev = writeQueues.get(key) ?? Promise.resolve();
  const p = prev.then(fn, fn);
  const tail = p.catch(() => undefined);
  writeQueues.set(key, tail);
  void tail.then(() => {
    if (writeQueues.get(key) === tail) writeQueues.delete(key);
  });
  return p;
}

// baseRev: 読み込んだときの rev。null は新規作成（既にあれば 409）
export function writeProjectFile(root: string, body: { path?: unknown; content?: unknown; baseRev?: unknown }): Promise<{ rev: string }> {
  const rel = checkRelPath(body.path);
  const { content, baseRev } = body;
  if (typeof content !== "string") throw new FileError(400, '"content" (string) is required');
  if (baseRev !== null && typeof baseRev !== "string") throw new FileError(400, '"baseRev" (string, or null for a new file) is required');
  // 対になっていないサロゲートは UTF-8 にできない
  if (/\p{Cs}/u.test(content)) throw new FileError(415, '"content" is not valid Unicode text');
  const buf = Buffer.from(content, "utf8");
  if (buf.length > MAX_FILE_BYTES) throw new FileError(413, `content is larger than ${MAX_FILE_BYTES} bytes`);
  const t = resolveTarget(root, rel);

  return serial(t.real, () => {
    let cur: Buffer | undefined;
    let mode: number | undefined;
    const st = fs.statSync(t.real, { throwIfNoEntry: false });
    if (st) {
      if (!st.isFile()) throw new FileError(400, `"${rel}" is not a regular file`);
      cur = fs.readFileSync(t.real);
      mode = st.mode & 0o7777;
    }
    const curRev = cur ? sha256(cur) : null;
    if (curRev !== baseRev) {
      let curContent: string | null = null;
      if (cur && cur.length <= MAX_FILE_BYTES) {
        try {
          curContent = utf8.decode(cur);
        } catch {
          curContent = null;
        }
      }
      const error = curRev === null ? `"${rel}" no longer exists` : baseRev === null ? `"${rel}" already exists` : `"${rel}" was changed on disk`;
      throw new FileError(409, error, { rev: curRev, content: curContent });
    }

    // 同じディレクトリの一時ファイルに書いてから rename（途中の内容を tinymist や外部に見せない）
    const tmp = path.join(path.dirname(t.real), `.${path.basename(t.real)}.typst-studio-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`);
    try {
      const fd = fs.openSync(tmp, "wx", mode ?? 0o666);
      try {
        fs.writeFileSync(fd, buf);
        // umask で落ちたビットを戻す（元のパーミッションを保つ）
        if (mode !== undefined) fs.fchmodSync(fd, mode);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, t.real);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    return { rev: sha256(buf) };
  });
}

// articles.glob に一致するファイル（リポジトリ相対、ソート済み）
export async function listArticles(project: ProjectConfig): Promise<{ path: string }[]> {
  const out: string[] = [];
  for await (const p of fs.promises.glob(project.articles.glob, {
    cwd: project.root,
    exclude: (n: string) => {
      const base = path.basename(n);
      return isGitSegment(base) || base === "node_modules";
    },
  })) {
    const rel = p.split(path.sep).join("/");
    if (fs.statSync(path.join(project.root, rel), { throwIfNoEntry: false })?.isFile()) out.push(rel);
  }
  out.sort();
  return out.map((p) => ({ path: p }));
}
