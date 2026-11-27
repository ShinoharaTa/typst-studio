import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "../src/app.js";
import { parseHostConfig } from "../src/config.js";
import { sha256 } from "../src/files.js";
import type { ImageCall } from "../src/images.js";
import { NoneDriver } from "../src/limits/none.js";
import { makeHome, makeProject } from "./helpers/repo.js";

process.env.LOG_LEVEL = "silent";

const ARTICLE = "articles/author-a/article.typ";
const BODY = ['= A', "", '#image("images/cat.png", width: 70%, alt: "A cat")', "", "#image(path)", ""].join("\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

let home: string;
let root: string;
let a: App;

beforeAll(async () => {
  home = makeHome();
  root = makeProject(home);
  fs.writeFileSync(path.join(root, ARTICLE), BODY);
  fs.mkdirSync(path.join(root, "articles", "author-a", "images"));
  fs.writeFileSync(path.join(root, "articles", "author-a", "images", "cat.png"), PNG);
  fs.writeFileSync(path.join(root, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  fs.writeFileSync(path.join(root, "notes.txt"), "text");
  fs.writeFileSync(path.join(home, "outside.png"), PNG);
  fs.symlinkSync(path.join(home, "outside.png"), path.join(root, "out.png"));
  const host = parseHostConfig({ auth: { mode: "none" } }, { home, dist: home, container: false, where: "config.toml" });
  a = buildApp(host, new NoneDriver(path.join(home, "state", "children")));
  await a.app.ready();
});

afterAll(async () => {
  await a.app.close();
  fs.rmSync(home, { recursive: true, force: true });
});

const list = (p: string) => a.app.inject({ method: "GET", url: `/api/projects/sample-book/images?path=${encodeURIComponent(p)}` });
const patch = (body: Record<string, unknown>) => a.app.inject({ method: "PATCH", url: "/api/projects/sample-book/images", payload: body });

describe("GET /api/projects/:name/images", () => {
  it("lists image() calls with rev", async () => {
    const res = await list(ARTICLE);
    expect(res.statusCode).toBe(200);
    const { rev, calls } = res.json() as { rev: string; calls: ImageCall[] };
    expect(rev).toBe(sha256(Buffer.from(BODY)));
    expect(calls).toEqual([
      {
        path: ARTICLE,
        start: BODY.indexOf("image("),
        end: BODY.indexOf(")") + 1,
        line: 3,
        column: 2,
        src: "images/cat.png",
        resolved: "articles/author-a/images/cat.png",
        editable: true,
        width: "70%",
        height: null,
        alt: "A cat",
      },
      expect.objectContaining({ src: null, resolved: null, editable: false, line: 5 }),
    ]);
  });

  it("rejects non-.typ and bad paths", async () => {
    expect((await list("notes.txt")).statusCode).toBe(400);
    expect((await list("../x.typ")).statusCode).toBe(400);
    expect((await list("missing.typ")).statusCode).toBe(404);
  });
});

describe("PATCH /api/projects/:name/images", () => {
  const start = BODY.indexOf("image(");

  it("returns the new content on dryRun without writing", async () => {
    const res = await patch({ path: ARTICLE, baseRev: sha256(Buffer.from(BODY)), start, set: { width: "50%" }, dryRun: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ content: BODY.replace("width: 70%", "width: 50%"), call: { start, width: "50%" } });
    expect(fs.readFileSync(path.join(root, ARTICLE), "utf8")).toBe(BODY);
  });

  it("writes only the argument range and returns the new rev", async () => {
    const res = await patch({ path: ARTICLE, baseRev: sha256(Buffer.from(BODY)), start, set: { width: "32mm", alt: null, height: "8em" } });
    expect(res.statusCode).toBe(200);
    const expected = BODY.replace('width: 70%, alt: "A cat"', "width: 32mm, height: 8em");
    expect(fs.readFileSync(path.join(root, ARTICLE), "utf8")).toBe(expected);
    expect(res.json()).toEqual({ rev: sha256(Buffer.from(expected)), call: expect.objectContaining({ width: "32mm", height: "8em", alt: null }) });
    fs.writeFileSync(path.join(root, ARTICLE), BODY);
  });

  it("409s on a stale baseRev like PUT /file", async () => {
    const res = await patch({ path: ARTICLE, baseRev: "0".repeat(64), start, set: { width: "50%" } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ rev: sha256(Buffer.from(BODY)), content: BODY });
  });

  it("422s when no editable call starts there, 400 on bad values", async () => {
    const rev = sha256(Buffer.from(BODY));
    expect((await patch({ path: ARTICLE, baseRev: rev, start: BODY.indexOf("image(path"), set: { width: "50%" } })).statusCode).toBe(422);
    expect((await patch({ path: ARTICLE, baseRev: rev, start: 0, set: { width: "50%" } })).statusCode).toBe(422);
    for (const w of ["50", "50 %", "1e2%", "50px", "calc(1)"]) {
      expect((await patch({ path: ARTICLE, baseRev: rev, start, set: { width: w } })).statusCode).toBe(400);
    }
    expect((await patch({ path: ARTICLE, baseRev: rev, start, set: { fit: "cover" } })).statusCode).toBe(400);
    expect((await patch({ path: ARTICLE, baseRev: rev, start, set: { alt: 1 } })).statusCode).toBe(400);
  });
});

describe("GET /api/projects/:name/raw", () => {
  const raw = (p: string) => a.app.inject({ method: "GET", url: `/api/projects/sample-book/raw?path=${encodeURIComponent(p)}` });
  it("returns images as they are", async () => {
    const res = await raw("articles/author-a/images/cat.png");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });
  it("sandboxes SVG", async () => {
    const res = await raw("logo.svg");
    expect(res.headers["content-type"]).toBe("image/svg+xml");
    expect(res.headers["content-security-policy"]).toBe("sandbox");
  });
  it("refuses other types, the outside and .git", async () => {
    expect((await raw("notes.txt")).statusCode).toBe(415);
    expect((await raw("out.png")).statusCode).toBe(403);
    expect((await raw(".git/x.png")).statusCode).toBe(403);
    expect((await raw("missing.png")).statusCode).toBe(404);
  });
});

describe("POST /api/projects/:name/upload (spec 4.5)", () => {
  const up = (name: string, body: Buffer, article = ARTICLE, type = "application/octet-stream") =>
    a.app.inject({
      method: "POST",
      url: `/api/projects/sample-book/upload?article=${encodeURIComponent(article)}&name=${encodeURIComponent(name)}`,
      headers: { "content-type": type },
      payload: body,
    });

  it("stores into the article's images/ with a normalized name, numbering on collision", async () => {
    const r1 = await up("My Photo.PNG", PNG);
    expect(r1.statusCode).toBe(201);
    expect(r1.json()).toEqual({ path: "articles/author-a/images/my-photo.png", insert: '#image("images/my-photo.png", width: 100%)' });
    const r2 = await up("my photo.png", PNG, ARTICLE, "image/png");
    expect(r2.json()).toMatchObject({ path: "articles/author-a/images/my-photo-2.png" });
    expect(fs.readFileSync(path.join(root, "articles/author-a/images/my-photo.png")).equals(PNG)).toBe(true);
    // 既存のファイルは上書きしない
    expect((await up("cat.png", PNG)).json()).toMatchObject({ path: "articles/author-a/images/cat-2.png" });
  });

  it("uses articles.upload_dir and creates the directory", async () => {
    const toml = fs.readFileSync(path.join(root, "typst-studio.toml"), "utf8");
    fs.writeFileSync(path.join(root, "typst-studio.toml"), toml.replace('glob = "articles/**/article.typ"', 'glob = "articles/**/article.typ"\nupload_dir = "figures/up"'));
    try {
      const res = await up("x.jpg", JPEG);
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ path: "articles/author-a/figures/up/x.jpg", insert: '#image("figures/up/x.jpg", width: 100%)' });
    } finally {
      fs.writeFileSync(path.join(root, "typst-studio.toml"), toml);
    }
  });

  it("rejects mismatched contents, other types, unknown articles and big files", async () => {
    expect((await up("a.png", JPEG)).statusCode).toBe(415);
    expect((await up("a.gif", Buffer.from("GIF89a"))).statusCode).toBe(415);
    expect((await up("a.png", PNG, "main.typ")).statusCode).toBe(400);
    expect((await up("a.png", PNG, "../x/article.typ")).statusCode).toBe(400);
    expect((await up("a.png", Buffer.alloc(0))).statusCode).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    expect((await up("big.png", big)).statusCode).toBe(413);
  });
});
