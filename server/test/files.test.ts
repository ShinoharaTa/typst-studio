import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "../src/app.js";
import { parseHostConfig, type HostConfig } from "../src/config.js";
import { MAX_FILE_BYTES, sha256, sha256File } from "../src/files.js";
import { NoneDriver } from "../src/limits/none.js";
import { git, makeHome, makeProject } from "./helpers/repo.js";

process.env.LOG_LEVEL = "silent";

const PUBLIC = "https://studio.example.test:8445";
let home: string;
let root: string;
let a: App;

const hostFor = (mode: "none" | "external"): HostConfig =>
  parseHostConfig({ server: { public_url: PUBLIC }, auth: { mode } }, { home, dist: home, container: false, where: "config.toml" });

beforeAll(async () => {
  home = makeHome();
  root = makeProject(home);
  fs.writeFileSync(path.join(home, "outside.typ"), "secret\n");
  fs.symlinkSync(path.join(home, "outside.typ"), path.join(root, "link-out.typ"));
  fs.symlinkSync(path.join(root, ".git", "config"), path.join(root, "link-git"));
  fs.symlinkSync(path.join(root, "main.typ"), path.join(root, "link-in.typ"));
  fs.writeFileSync(path.join(root, "bin.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00]));
  // ここまでで未追跡が 4 つ（link-out / link-git / link-in / bin.png）
  // 設定の読めないプロジェクト
  fs.mkdirSync(path.join(home, "projects", "broken"));
  a = buildApp(hostFor("none"), new NoneDriver(path.join(home, "state", "children")));
  await a.app.ready();
});

afterAll(async () => {
  await a.app.close();
  fs.rmSync(home, { recursive: true, force: true });
});

const get = (p: string) => a.app.inject({ method: "GET", url: `/api/projects/sample-book/file?path=${p}` });
const put = (body: unknown) =>
  a.app.inject({ method: "PUT", url: "/api/projects/sample-book/file", payload: body as Record<string, unknown> });

describe("GET /api/projects", () => {
  it("lists projects with git state, and broken ones with an error", async () => {
    const res = await a.app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Record<string, unknown>[];
    expect(list.map((p) => p.name)).toEqual(["broken", "sample-book"]);
    expect(list[1]).toMatchObject({ name: "sample-book", branch: "main", detached: false, uncommitted: 4, unpushed: null, upstream: null });
    expect(list[1].head).toMatch(/^[0-9a-f]{40}$/);
    expect(list[1].error).toBeUndefined();
    expect(list[0].error).toMatch(/typst-studio\.toml/);
  });
});

describe("GET /api/projects/:name/articles", () => {
  it("returns files matching articles.glob", async () => {
    const res = await a.app.inject({ method: "GET", url: "/api/projects/sample-book/articles" });
    expect(res.json()).toEqual([{ path: "articles/author-a/article.typ" }]);
  });

  it("404 for an unknown project, 400 for a broken config", async () => {
    expect((await a.app.inject({ method: "GET", url: "/api/projects/nope/articles" })).statusCode).toBe(404);
    expect((await a.app.inject({ method: "GET", url: "/api/projects/broken/articles" })).statusCode).toBe(400);
  });
});

describe("file read / write", () => {
  it("reads with rev = sha256 of the content", async () => {
    const res = await get("main.typ");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ path: "main.typ", content: "= Book\n", rev: sha256(Buffer.from("= Book\n")) });
  });

  it("writes with the current baseRev and keeps the file mode", async () => {
    fs.chmodSync(path.join(root, "main.typ"), 0o640);
    const { rev } = (await get("main.typ")).json() as { rev: string };
    const res = await put({ path: "main.typ", content: "= Book 2\n", baseRev: rev });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rev: sha256(Buffer.from("= Book 2\n")) });
    expect(fs.readFileSync(path.join(root, "main.typ"), "utf8")).toBe("= Book 2\n");
    expect(fs.statSync(path.join(root, "main.typ")).mode & 0o777).toBe(0o640);
    // 一時ファイルが残らない
    expect(fs.readdirSync(root).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("rejects a stale baseRev with 409 and returns the latest", async () => {
    const { rev } = (await get("main.typ")).json() as { rev: string };
    fs.writeFileSync(path.join(root, "main.typ"), "= changed outside\n");
    const res = await put({ path: "main.typ", content: "= mine\n", baseRev: rev });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ rev: sha256(Buffer.from("= changed outside\n")), content: "= changed outside\n" });
    expect(fs.readFileSync(path.join(root, "main.typ"), "utf8")).toBe("= changed outside\n");
  });

  it("creates a new file with baseRev null, and 409 if it already exists", async () => {
    const res = await put({ path: "articles/author-a/new.typ", content: "new\n", baseRev: null });
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(root, "articles/author-a/new.typ"), "utf8")).toBe("new\n");
    const again = await put({ path: "articles/author-a/new.typ", content: "again\n", baseRev: null });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ rev: sha256(Buffer.from("new\n")), content: "new\n" });
  });

  it("409 when the file was deleted (rev null)", async () => {
    fs.writeFileSync(path.join(root, "gone.typ"), "x");
    fs.rmSync(path.join(root, "gone.typ"));
    const res = await put({ path: "gone.typ", content: "y", baseRev: sha256(Buffer.from("x")) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ rev: null, content: null });
  });

  it("writes through a symlink that stays inside the project", async () => {
    const { rev } = (await get("link-in.typ")).json() as { rev: string };
    expect((await put({ path: "link-in.typ", content: "= via link\n", baseRev: rev })).statusCode).toBe(200);
    expect(fs.lstatSync(path.join(root, "link-in.typ")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(root, "main.typ"), "utf8")).toBe("= via link\n");
  });

  it("requires baseRev (string or null) and string content", async () => {
    expect((await put({ path: "main.typ", content: "x" })).statusCode).toBe(400);
    expect((await put({ path: "main.typ", content: 1, baseRev: null })).statusCode).toBe(400);
  });

  it("rejects non UTF-8 and files over 2MB", async () => {
    expect((await get("bin.png")).statusCode).toBe(415);
    const big = "a".repeat(MAX_FILE_BYTES + 1);
    expect((await put({ path: "big.typ", content: big, baseRev: null })).statusCode).toBe(413);
    expect(fs.existsSync(path.join(root, "big.typ"))).toBe(false);
    // ちょうど 2MB は通る
    expect((await put({ path: "big.typ", content: "a".repeat(MAX_FILE_BYTES), baseRev: null })).statusCode).toBe(200);
    fs.rmSync(path.join(root, "big.typ"));
    // 対になっていないサロゲートは UTF-8 にできない
    expect((await put({ path: "s.typ", content: "a\ud800b", baseRev: null })).statusCode).toBe(415);
  });

  it("404 for a missing file", async () => {
    expect((await get("nope.typ")).statusCode).toBe(404);
    expect((await put({ path: "nodir/x.typ", content: "x", baseRev: null })).statusCode).toBe(404);
  });
});

describe("path escapes are rejected (spec 7.3)", () => {
  const cases: [string, number][] = [
    ["..%2Foutside.typ", 400],
    ["%2e%2e%2Foutside.typ", 400],
    ["articles%2F..%2F..%2Foutside.typ", 400],
    ["%2Fetc%2Fpasswd", 400],
    ["./main.typ", 400],
    ["articles%2F%2Fauthor-a%2Farticle.typ", 400],
    ["link-out.typ", 403],
    ["link-git", 403],
    [".git%2Fconfig", 403],
    [".git%2FHEAD", 403],
    [".GIT%2Fconfig", 403],
    ["articles%2F.git%2Fx", 403],
  ];

  it("on GET", async () => {
    for (const [p, code] of [...cases, [encodeURIComponent(path.join(home, "outside.typ")), 400] as [string, number]]) {
      const res = await get(p);
      expect([p, res.statusCode]).toEqual([p, code]);
    }
  });

  it("on PUT (and nothing is written)", async () => {
    const before = fs.readFileSync(path.join(root, ".git", "config"), "utf8");
    const bodies: [string, number][] = [
      ["../outside.typ", 400],
      ["articles/../../outside.typ", 400],
      [path.join(home, "outside.typ"), 400],
      ["link-out.typ", 403],
      ["link-git", 403],
      [".git/config", 403],
      [".git/hooks/pre-commit", 403],
    ];
    for (const [p, code] of bodies) {
      const res = await put({ path: p, content: "pwned\n", baseRev: null });
      expect([p, res.statusCode]).toEqual([p, code]);
    }
    expect(fs.readFileSync(path.join(home, "outside.typ"), "utf8")).toBe("secret\n");
    expect(fs.readFileSync(path.join(root, ".git", "config"), "utf8")).toBe(before);
    expect(fs.existsSync(path.join(root, ".git", "hooks", "pre-commit"))).toBe(false);
  });

  it("a symlinked directory that leaves the project cannot be written into", async () => {
    fs.mkdirSync(path.join(home, "outdir"));
    fs.symlinkSync(path.join(home, "outdir"), path.join(root, "outdir"));
    const res = await put({ path: "outdir/x.typ", content: "x", baseRev: null });
    expect(res.statusCode).toBe(403);
    expect(fs.readdirSync(path.join(home, "outdir"))).toEqual([]);
  });
});

describe("review fixes", () => {
  it("keeps a UTF-8 BOM through read and save (bytes unchanged)", async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("= BOM\n")]);
    fs.writeFileSync(path.join(root, "bom.typ"), bytes);
    const f = (await get("bom.typ")).json() as { content: string; rev: string };
    expect(f.content.charCodeAt(0)).toBe(0xfeff);
    expect(f.rev).toBe(sha256(bytes));
    const res = await put({ path: "bom.typ", content: f.content, baseRev: f.rev });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { rev: string }).rev).toBe(f.rev);
    expect(fs.readFileSync(path.join(root, "bom.typ")).equals(bytes)).toBe(true);
  });

  it("concurrent PUTs with the same baseRev: exactly one 200, the rest 409", async () => {
    fs.writeFileSync(path.join(root, "race.typ"), "0\n");
    const { rev } = (await get("race.typ")).json() as { rev: string };
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => put({ path: "race.typ", content: `w${i}\n`, baseRev: rev })),
    );
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409, 409, 409, 409, 409, 409, 409]);
    const winner = results.find((r) => r.statusCode === 200)!.json() as { rev: string };
    expect(sha256(fs.readFileSync(path.join(root, "race.typ")))).toBe(winner.rev);
  });

  it("rejects a dangling symlink and does not create its target", async () => {
    const target = path.join(home, "dangling-target.typ");
    fs.symlinkSync(target, path.join(root, "dangling.typ"));
    fs.symlinkSync(path.join(root, "nope-inside.typ"), path.join(root, "dangling-in.typ"));
    for (const p of ["dangling.typ", "dangling-in.typ"]) {
      expect((await get(p)).statusCode).toBe(403);
      expect((await put({ path: p, content: "x", baseRev: null })).statusCode).toBe(403);
    }
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(path.join(root, "nope-inside.typ"))).toBe(false);
  });

  it("rejects writes through a directory link into .git", async () => {
    fs.symlinkSync(path.join(root, ".git"), path.join(root, "gitdir-link"));
    fs.symlinkSync(path.join(root, ".git", "hooks"), path.join(root, "hooks-link"));
    for (const p of ["gitdir-link/config", "hooks-link/pre-commit", "gitdir-link/new"]) {
      expect([p, (await put({ path: p, content: "x", baseRev: null })).statusCode]).toEqual([p, 403]);
      expect([p, (await get(p)).statusCode]).toEqual([p, 403]);
    }
    expect(fs.existsSync(path.join(root, ".git", "hooks", "pre-commit"))).toBe(false);
  });

  it("maps ENOTDIR / ENAMETOOLONG / ELOOP / EACCES to 4xx, not 500", async () => {
    fs.symlinkSync("loop-b", path.join(root, "loop-a"));
    fs.symlinkSync("loop-a", path.join(root, "loop-b"));
    fs.mkdirSync(path.join(root, "locked"));
    fs.writeFileSync(path.join(root, "locked", "x.typ"), "x");
    fs.chmodSync(path.join(root, "locked"), 0o000);
    try {
      const cases: [string, number][] = [
        ["main.typ/x", 404],
        ["a".repeat(300) + ".typ", 400],
        [Array.from({ length: 30 }, () => "b".repeat(200)).join("/"), 400],
        ["loop-a", 403],
        ["loop-a/x", 403],
        ["locked/x.typ", 403],
      ];
      for (const [p, code] of cases) {
        const g = await get(encodeURIComponent(p));
        expect([p.slice(0, 20), "GET", g.statusCode]).toEqual([p.slice(0, 20), "GET", code]);
        const w = await put({ path: p, content: "x", baseRev: null });
        expect([p.slice(0, 20), "PUT", w.statusCode]).toEqual([p.slice(0, 20), "PUT", code]);
      }
    } finally {
      fs.chmodSync(path.join(root, "locked"), 0o755);
    }
  });

  it("does not overwrite a read-only (0444) file", async () => {
    fs.writeFileSync(path.join(root, "ro.typ"), "ro\n");
    fs.chmodSync(path.join(root, "ro.typ"), 0o444);
    const { rev } = (await get("ro.typ")).json() as { rev: string };
    expect((await put({ path: "ro.typ", content: "rw\n", baseRev: rev })).statusCode).toBe(403);
    expect(fs.readFileSync(path.join(root, "ro.typ"), "utf8")).toBe("ro\n");
  });

  it("sha256File (streamed, used by the watcher) matches sha256 of the bytes", async () => {
    const buf = Buffer.alloc(3 * 1024 * 1024 + 7, 0x61);
    fs.writeFileSync(path.join(home, "stream.bin"), buf);
    expect(await sha256File(path.join(home, "stream.bin"))).toBe(sha256(buf));
  });

  it("413 on PUT when the file on disk is over 2MB (without reading it)", async () => {
    fs.writeFileSync(path.join(root, "huge.bin"), "");
    fs.truncateSync(path.join(root, "huge.bin"), MAX_FILE_BYTES + 1);
    expect((await put({ path: "huge.bin", content: "x", baseRev: "0".repeat(64) })).statusCode).toBe(413);
    expect((await get("huge.bin")).statusCode).toBe(413);
  });

  it("articles.glob cannot list names outside the project, or through an outward directory link", async () => {
    const r = path.join(home, "projects", "globby");
    fs.mkdirSync(path.join(r, "articles", "author-a"), { recursive: true });
    fs.writeFileSync(path.join(r, "main.typ"), "= B\n");
    fs.writeFileSync(path.join(r, "articles", "author-a", "article.typ"), "= A\n");
    fs.writeFileSync(path.join(r, "typst-studio.toml"), '[project]\ntypst = "0.14.2"\n[book]\nentry = "main.typ"\n[articles]\nglob = "{..,articles}/**/*.typ"\n');
    fs.mkdirSync(path.join(home, "ext"));
    fs.writeFileSync(path.join(home, "ext", "leak.typ"), "x");
    fs.symlinkSync(path.join(home, "ext"), path.join(r, "articles", "ext"));
    const res = await a.app.inject({ method: "GET", url: "/api/projects/globby/articles" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ path: "articles/author-a/article.typ" }]);
  });

  it("a project that is not a repository does not report its parent repository", async () => {
    const h = makeHome();
    try {
      git(h, "init", "-q");
      const r = path.join(h, "projects", "plain");
      fs.mkdirSync(path.join(r, "articles"), { recursive: true });
      fs.writeFileSync(path.join(r, "main.typ"), "= B\n");
      fs.writeFileSync(path.join(r, "typst-studio.toml"), '[project]\ntypst = "0.14.2"\n[book]\nentry = "main.typ"\n[articles]\nglob = "articles/*.typ"\n');
      const host = parseHostConfig({ auth: { mode: "none" } }, { home: h, dist: h, container: false, where: "config.toml" });
      const b = buildApp(host, new NoneDriver(path.join(h, "state", "children")));
      try {
        const list = (await b.app.inject({ method: "GET", url: "/api/projects" })).json() as Record<string, unknown>[];
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ name: "plain", branch: null, uncommitted: null });
        expect(list[0].gitError).toMatch(/not a git repository/);
      } finally {
        await b.app.close();
      }
    } finally {
      fs.rmSync(h, { recursive: true, force: true });
    }
  });

  it("/api/projects does not 500 when a project cannot be resolved", async () => {
    // projects/ 直下の、指す先の無いディレクトリリンク（一覧には出ないこと）と、読めないディレクトリ
    fs.symlinkSync(path.join(home, "no-such-dir"), path.join(home, "projects", "gone"));
    const res = await a.app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    fs.rmSync(path.join(home, "projects", "gone"));
  });
});

describe("Origin check on PUT (auth.mode = external)", () => {
  it("403 without Origin or with another Origin, 200 with public_url", async () => {
    const b = buildApp(hostFor("external"), new NoneDriver(path.join(home, "state", "children")));
    await b.app.ready();
    try {
      const url = "/api/projects/sample-book/file";
      const { rev } = (await b.app.inject({ method: "GET", url: `${url}?path=main.typ` })).json() as { rev: string };
      const payload = { path: "main.typ", content: "= origin\n", baseRev: rev };
      expect((await b.app.inject({ method: "PUT", url, payload })).statusCode).toBe(403);
      expect((await b.app.inject({ method: "PUT", url, payload, headers: { origin: "https://evil.example" } })).statusCode).toBe(403);
      expect((await b.app.inject({ method: "PUT", url, payload, headers: { origin: PUBLIC } })).statusCode).toBe(200);
    } finally {
      await b.app.close();
    }
  });
});
