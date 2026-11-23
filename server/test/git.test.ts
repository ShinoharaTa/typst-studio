import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ALLOWED_SUBCOMMANDS, parseStatus, readGitStatus, runGit } from "../src/git.js";
import { git, makeHome, makeProject } from "./helpers/repo.js";

const home = makeHome();
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe("git allowlist (spec 5.5)", () => {
  it("allows only status and rev-parse", () => {
    expect([...ALLOWED_SUBCOMMANDS].sort()).toEqual(["rev-parse", "status"]);
  });

  it("refuses every other subcommand without running git", async () => {
    const root = makeProject(home, "allowlist");
    for (const sub of ["add", "commit", "checkout", "switch", "fetch", "pull", "push", "stash", "worktree", "config", "reset", "-c", "--git-dir=x"]) {
      await expect(runGit(root, sub, ["-m", "x"])).rejects.toMatchObject({ code: "not-allowed" });
    }
    expect(git(root, "log", "--oneline").trim().split("\n")).toHaveLength(1);
  });

  it("is the only module under server/src that runs git", () => {
    const src = path.resolve(import.meta.dirname, "../src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".ts") && path.relative(src, p) !== "git.ts") {
          const text = fs.readFileSync(p, "utf8");
          if (/["'`]git["'`]/.test(text)) offenders.push(path.relative(src, p));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
    // git.ts の中でも、プロセスを起こすのは runGit の execFile 1 か所だけ
    const gitTs = fs.readFileSync(path.join(src, "git.ts"), "utf8");
    expect(gitTs.match(/(?<![.\w])(execFile|spawn|exec|fork|execSync|execFileSync|spawnSync)\(/g)).toEqual(["execFile("]);
  });
});

describe("parseStatus", () => {
  it("reads branch, head, upstream, ahead and counts entries", () => {
    const out = [
      "# branch.oid 0123456789abcdef0123456789abcdef01234567",
      "# branch.head feature/x",
      "# branch.upstream origin/feature/x",
      "# branch.ab +3 -1",
      "1 .M N... 100644 100644 100644 aaa bbb main.typ",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new.typ\told.typ",
      "u UU N... 100644 100644 100644 100644 a b c conflict.typ",
      "? untracked.typ",
      "",
    ].join("\n");
    expect(parseStatus(out)).toEqual({
      branch: "feature/x",
      detached: false,
      head: "0123456789abcdef0123456789abcdef01234567",
      uncommitted: 4,
      unpushed: 3,
      upstream: "origin/feature/x",
    });
  });

  it("detached HEAD and no upstream", () => {
    expect(parseStatus("# branch.oid abc\n# branch.head (detached)\n")).toEqual({
      branch: null,
      detached: true,
      head: "abc",
      uncommitted: 0,
      unpushed: null,
      upstream: null,
    });
  });

  it("initial commit and an upstream that is gone (no branch.ab)", () => {
    expect(parseStatus("# branch.oid (initial)\n# branch.head main\n# branch.upstream origin/main\n")).toMatchObject({
      head: null,
      unpushed: null,
      upstream: "origin/main",
    });
  });
});

describe("readGitStatus on a real repository", () => {
  it("counts uncommitted and unpushed", async () => {
    const remote = path.join(home, "remote.git");
    git(home, "init", "-q", "--bare", remote);
    const root = makeProject(home, "real");
    expect(await readGitStatus(root)).toMatchObject({ branch: "main", detached: false, uncommitted: 0, unpushed: null, upstream: null });

    git(root, "remote", "add", "origin", remote);
    git(root, "push", "-q", "-u", "origin", "main");
    fs.writeFileSync(path.join(root, "main.typ"), "= Book 2\n");
    git(root, "commit", "-q", "-am", "second");
    fs.writeFileSync(path.join(root, "main.typ"), "= Book 3\n");
    fs.writeFileSync(path.join(root, "new.typ"), "x\n");
    expect(await readGitStatus(root)).toMatchObject({ branch: "main", uncommitted: 2, unpushed: 1, upstream: "origin/main" });

    git(root, "switch", "-q", "--detach", "HEAD");
    expect(await readGitStatus(root)).toMatchObject({ branch: null, detached: true });
  });

  it("does not take index.lock (--no-optional-locks)", async () => {
    const root = makeProject(home, "locks");
    fs.writeFileSync(path.join(root, ".git", "index.lock"), "");
    // ロックが残っていても読める（status は index を書き戻さない）
    await expect(readGitStatus(root)).resolves.toMatchObject({ branch: "main" });
  });

  it("explains dubious ownership instead of adding safe.directory", async () => {
    const root = makeProject(home, "owner");
    const before = git(root, "config", "--list", "--show-origin");
    process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = "1";
    try {
      const err = await readGitStatus(root).then(
        () => undefined,
        (e: Error & { code: string }) => e,
      );
      expect(err).toMatchObject({ code: "dubious-ownership" });
      expect(err?.message).toMatch(/owned by a different user/);
      expect(err?.message).toMatch(/does not add safe\.directory/);
    } finally {
      delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
    }
    expect(git(root, "config", "--list", "--show-origin")).toBe(before);
  });

  it("reports a directory that is not a repository", async () => {
    const dir = path.join(home, "plain");
    fs.mkdirSync(dir);
    // 親（一時ディレクトリ）をたどってほかのリポジトリを拾わないように
    process.env.GIT_CEILING_DIRECTORIES = home;
    try {
      await expect(readGitStatus(dir)).rejects.toMatchObject({ code: "not-a-repository" });
    } finally {
      delete process.env.GIT_CEILING_DIRECTORIES;
    }
  });
});
