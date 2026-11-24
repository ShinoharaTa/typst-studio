import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// テスト用の一時 TYPST_STUDIO_HOME と、projects/<name> の git リポジトリ。
// テスト側の git 操作（commit / switch など）はここで直接呼ぶ（studio のコードではない）

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
}

export const PROJECT_TOML = `[project]
typst = "0.14.2"

[book]
entry = "main.typ"

[articles]
glob = "articles/**/article.typ"
`;

export function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "typst-studio-test-"));
}

export function makeProject(home: string, name = "sample-book"): string {
  const root = path.join(home, "projects", name);
  fs.mkdirSync(path.join(root, "articles", "author-a"), { recursive: true });
  fs.writeFileSync(path.join(root, "typst-studio.toml"), PROJECT_TOML);
  fs.writeFileSync(path.join(root, "main.typ"), "= Book\n");
  fs.writeFileSync(path.join(root, "articles", "author-a", "article.typ"), "= A\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return fs.realpathSync(root);
}
