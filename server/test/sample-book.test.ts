import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadProjectConfig, parseHostConfig } from "../src/config.js";
import { listArticles } from "../src/files.js";
import { makeHome } from "./helpers/repo.js";

// 同梱のサンプルの本（examples/sample-book）が、そのまま studio のプロジェクトとして読めること
const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../examples/sample-book");

describe("examples/sample-book", () => {
  const home = makeHome();
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, "projects"));
  fs.symlinkSync(SAMPLE, path.join(home, "projects", "sample-book"));
  const host = parseHostConfig({ auth: { mode: "none" } }, { home, dist: home, container: false, where: "config.toml" });

  it("passes project config validation", () => {
    const c = loadProjectConfig(host, "sample-book");
    expect(c.project.typst).toBe("0.14.2");
    expect(c.fonts).toEqual({ paths: ["fonts"], system: false });
    expect(c.book).toEqual({ entry: "main.typ", previewProfile: "print" });
    expect(Object.keys(c.profiles).sort()).toEqual(["ebook", "print"]);
    expect(c.preview.inputs).toEqual({ ARTICLE: "{article_entry}", EBOOK: "true" });
  });

  it("lists every article, including the two-level ones", async () => {
    const c = loadProjectConfig(host, "sample-book");
    const articles = (await listArticles(c)).map((a) => a.path).sort();
    expect(articles).toEqual([
      "articles/author-a/intro/article.typ",
      "articles/author-a/layout/article.typ",
      "articles/author-b/article.typ",
    ]);
  });
});
