import { execFile } from "node:child_process";

// Git の読み取り（spec 5.2）。studio が git を呼ぶのはこのファイルだけ。
// 許可するのは status と rev-parse の読み取りだけで、書き込み系（add / commit / checkout / fetch ...）は呼べない

export const ALLOWED_SUBCOMMANDS: ReadonlySet<string> = new Set(["status", "rev-parse"]);

export interface GitInfo {
  // detached のときは null（head を見る）
  branch: string | null;
  detached: boolean;
  // HEAD のコミット。コミットが 1 つも無いときは null
  head: string | null;
  uncommitted: number;
  // upstream が無い（または upstream のブランチが無い）ときは null
  unpushed: number | null;
  upstream: string | null;
}

export type GitErrorCode = "dubious-ownership" | "not-a-repository" | "git-not-found" | "not-allowed" | "failed";

export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// フックなどから継承した GIT_DIR 等で別のリポジトリを読まないよう外す
const DROP_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"];

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of DROP_ENV) delete env[k];
  // エラー文の判定を英語で行う。認証を求める対話は出さない（そもそも GitHub に接続しない）
  env.LC_ALL = "C";
  env.LANGUAGE = "C";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  return env;
}

// git を 1 回実行して stdout を返す。サブコマンドは許可リストに限る
export function runGit(cwd: string, subcommand: string, args: string[] = []): Promise<string> {
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    return Promise.reject(new GitError("not-allowed", `git ${subcommand} is not allowed (read-only: ${[...ALLOWED_SUBCOMMANDS].join(", ")})`));
  }
  // --no-optional-locks: ホスト側の git 操作と index.lock を取り合わない（spec 10.9）
  const argv = ["--no-optional-locks", subcommand, ...args];
  return new Promise((resolve, reject) => {
    execFile("git", argv, { cwd, env: gitEnv(), timeout: 10_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reject(new GitError("git-not-found", "git is not installed (or not on PATH)"));
      }
      reject(toGitError(cwd, stderr || err.message));
    });
  });
}

function toGitError(cwd: string, stderr: string): GitError {
  if (/dubious ownership/i.test(stderr)) {
    const uid = typeof process.getuid === "function" ? process.getuid() : "?";
    return new GitError(
      "dubious-ownership",
      `git refused to read ${cwd}: the repository is owned by a different user than the studio process (uid ${uid}). ` +
        `Run studio as the owner of the repository, or fix the ownership (chown). ` +
        `typst-studio does not add safe.directory automatically.`,
    );
  }
  if (/not a git repository/i.test(stderr)) return new GitError("not-a-repository", `${cwd} is not a git repository`);
  return new GitError("failed", stderr.trim());
}

// git status --porcelain=v2 --branch の出力を読む
export function parseStatus(out: string): GitInfo {
  const info: GitInfo = { branch: null, detached: false, head: null, uncommitted: 0, unpushed: null, upstream: null };
  for (const line of out.split("\n")) {
    if (line === "") continue;
    if (line.startsWith("# ")) {
      const [key, ...rest] = line.slice(2).split(" ");
      const val = rest.join(" ");
      if (key === "branch.oid") info.head = val === "(initial)" ? null : val;
      else if (key === "branch.head") {
        info.detached = val === "(detached)";
        info.branch = info.detached ? null : val;
      } else if (key === "branch.upstream") info.upstream = val;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(val);
        if (m) info.unpushed = Number(m[1]);
      }
      continue;
    }
    // 1: 変更 / 2: リネーム・コピー / u: 衝突 / ?: 未追跡（! は無視されたファイルで、既定では出ない）
    if (/^[12u?] /.test(line)) info.uncommitted++;
  }
  return info;
}

export async function readGitStatus(root: string): Promise<GitInfo> {
  return parseStatus(await runGit(root, "status", ["--porcelain=v2", "--branch"]));
}

// .git の実体（.git がファイルの worktree / submodule でも正しい場所）
export async function gitDir(root: string): Promise<string> {
  return (await runGit(root, "rev-parse", ["--absolute-git-dir"])).trim();
}
