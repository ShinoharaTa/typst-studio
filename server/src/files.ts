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
    readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 422,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ファイルの sha256 を少しずつ読んで計算する（大きなファイルを丸ごとメモリに載せない）
export async function sha256File(abs: string): Promise<string> {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(abs, { highWaterMark: 1024 * 1024 })) h.update(chunk as Buffer);
  return h.digest("hex");
}

// fs のエラーを API のエラーにする（ENOTDIR・ENAMETOOLONG などを 500 にしない）
function fsError(e: unknown, rel: string): unknown {
  if (e instanceof FileError) return e;
  switch ((e as NodeJS.ErrnoException).code) {
    case "ENOENT":
    case "ENOTDIR":
      return new FileError(404, `"${rel}" does not exist`);
    case "ENAMETOOLONG":
      return new FileError(400, `"${rel}" is too long`);
    case "ELOOP":
      return new FileError(403, `"${rel}" has too many levels of symbolic links`);
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return new FileError(403, `"${rel}" is not accessible`);
    case "EISDIR":
      return new FileError(400, `"${rel}" is not a regular file`);
    default:
      return e;
  }
}

function mapFs<T>(rel: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw fsError(e, rel);
  }
}

// プロジェクトのディレクトリ（実パス）。設定が読めなくても返す（壊れた typst-studio.toml を直せるように）
export function projectRoot(host: HostConfig, name: string): string {
  if (!PROJECT_NAME_RE.test(name)) throw new FileError(400, `invalid project name "${name}"`);
  const dir = path.join(host.home, "projects", name);
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new FileError(404, `project "${name}" not found`);
  return fs.realpathSync(dir);
}

// Linux の PATH_MAX / NAME_MAX
const MAX_PATH_BYTES = 4096;
const MAX_NAME_BYTES = 255;

const isGitSegment = (s: string) => s.toLowerCase() === ".git";

// API で受け取るリポジトリ相対パスの形を検証する（実在は問わない）
export function checkRelPath(rel: unknown): string {
  if (typeof rel !== "string" || rel === "") throw new FileError(400, '"path" (string) is required');
  if (rel.includes("\0")) throw new FileError(400, "path must not contain NUL");
  if (Buffer.byteLength(rel) > MAX_PATH_BYTES) throw new FileError(400, "path is too long");
  if (path.isAbsolute(rel)) throw new FileError(400, `"${rel}" must be a relative path inside the project`);
  const segs = rel.split("/");
  if (segs.includes("..")) throw new FileError(400, `"${rel}" must not contain ".."`);
  if (path.posix.normalize(rel) !== rel || rel.endsWith("/")) throw new FileError(400, `"${rel}" must be a normalized path`);
  if (segs.some(isGitSegment)) throw new FileError(403, `"${rel}" is inside .git/`);
  if (segs.some((x) => Buffer.byteLength(x) > MAX_NAME_BYTES)) throw new FileError(400, "a path segment is too long");
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

// 実パスがルート配下か（rename 直前の再検査用）
function checkRealInside(root: string, real: string, rel: string): void {
  if (real !== root && !real.startsWith(root + path.sep)) throw new FileError(403, `"${rel}" points outside the project`);
  checkRealNotGit(root, real, rel);
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
    // 宙ぶらりんのシンボリックリンク（指す先に新規作成させない）
    if (lst.isSymbolicLink() && !fs.existsSync(abs)) throw new FileError(403, `"${rel}" is a dangling symbolic link`);
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

// ignoreBOM: 先頭の BOM を内容として残す（読んで保存するだけで BOM が消えないように）
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

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
  return mapFs(rel, () => {
    // 無いファイルでも、親が .git の中やルートの外なら 403（存在を漏らさない）
    const t = resolveTarget(root, rel);
    if (!t.exists) throw new FileError(404, `"${rel}" does not exist`);
    const size = fs.statSync(t.real).size;
    if (size > MAX_FILE_BYTES) throw new FileError(413, `"${rel}" is larger than ${MAX_FILE_BYTES} bytes`);
    const buf = fs.readFileSync(t.real);
    return { path: rel, content: decode(buf, rel), rev: sha256(buf) };
  });
}

// 書き込みはプロジェクトごとに studio の中で順に行う（パスの解決・rev の確認から rename までの間に割り込ませない）
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

  return serial(root, () => mapFs(rel, () => {
    const t = resolveTarget(root, rel);
    let cur: Buffer | undefined;
    let mode: number | undefined;
    const st = fs.statSync(t.real, { throwIfNoEntry: false });
    if (st) {
      if (!st.isFile()) throw new FileError(400, `"${rel}" is not a regular file`);
      // 読み込みの上限を超えるファイルは読まずに断る
      if (st.size > MAX_FILE_BYTES) throw new FileError(413, `"${rel}" on disk is larger than ${MAX_FILE_BYTES} bytes`);
      // 読み取り専用（0444 など）のファイルは上書きしない
      try {
        fs.accessSync(t.real, fs.constants.W_OK);
      } catch {
        throw new FileError(403, `"${rel}" is not writable`);
      }
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
        // 所有者・グループが自分と違うファイルは、同じ所有者で置き換えられるときだけ書く
        if (st && (st.uid !== process.getuid?.() || st.gid !== process.getgid?.())) {
          try {
            fs.fchownSync(fd, st.uid, st.gid);
          } catch {
            throw new FileError(403, `"${rel}" is owned by another user or group; refusing to change its owner`);
          }
        }
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      // rename 直前に、書き込み先のディレクトリがまだルート配下か確かめる（途中でリンクに差し替えられていないか）
      checkRealInside(root, fs.realpathSync(path.dirname(tmp)), rel);
      fs.renameSync(tmp, t.real);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    return { rev: sha256(buf) };
  }));
}

// 実在するファイルの実パス（バイナリの配信用。readProjectFile と同じ検査）
export function resolveExistingFile(root: string, relIn: unknown): { path: string; real: string; size: number } {
  const rel = checkRelPath(relIn);
  return mapFs(rel, () => {
    const t = resolveTarget(root, rel);
    if (!t.exists) throw new FileError(404, `"${rel}" does not exist`);
    return { path: rel, real: t.real, size: fs.statSync(t.real).size };
  });
}

// ルート配下のディレクトリを（無ければ）作る。途中のシンボリックリンクがルートの外や .git/ を指していれば 403
function mkdirInside(root: string, dirRel: string): void {
  if (dirRel === ".") return;
  let cur = root;
  for (const seg of dirRel.split("/")) {
    const next = path.join(cur, seg);
    if (!fs.lstatSync(next, { throwIfNoEntry: false })) fs.mkdirSync(next);
    const real = fs.realpathSync(next);
    checkRealInside(root, real, dirRel);
    if (!fs.statSync(real).isDirectory()) throw new FileError(400, `"${dirRel}" is not a directory`);
    cur = real;
  }
}

// 新しいファイルを作る（画像のアップロード用）。既にあれば false。親ディレクトリが無ければ作る。
// 一時ファイルに書いてから link で置く（既存のファイルを上書きせず、途中の内容も見せない）
export function createProjectFile(root: string, relIn: unknown, buf: Buffer): Promise<boolean> {
  const rel = checkRelPath(relIn);
  return serial(root, () => mapFs(rel, () => {
    mkdirInside(root, path.posix.dirname(rel));
    const t = resolveTarget(root, rel);
    if (t.exists) return false;
    const tmp = path.join(path.dirname(t.real), `.${path.basename(t.real)}.typst-studio-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`);
    try {
      const fd = fs.openSync(tmp, "wx", 0o666);
      try {
        fs.writeFileSync(fd, buf);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      checkRealInside(root, fs.realpathSync(path.dirname(tmp)), rel);
      try {
        fs.linkSync(tmp, t.real);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw e;
      }
      return true;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }));
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
    // glob が {..,x} などでルートの外を指しても一覧に出さない。外向きのディレクトリリンク経由も除く
    if (path.isAbsolute(rel) || rel.split("/").includes("..")) continue;
    try {
      checkRelPath(rel);
      const abs = inside(project.root, rel, "articles.glob");
      checkRealNotGit(project.root, fs.realpathSync(abs), rel);
      if (fs.statSync(abs).isFile()) out.push(rel);
    } catch {
      continue;
    }
  }
  out.sort();
  return out.map((p) => ({ path: p }));
}
