import { describe, expect, it } from "vitest";
import { articleContext, articleLabel, articleTitle, groupArticles } from "./article-label";

const MIXED = [
  "articles/intro/article.typ",
  "articles/author-b/setup/article.typ",
  "articles/author-b/tips/article.typ",
  "articles/a/b/c/article.typ",
];

describe("articleLabel", () => {
  it("names articles by their directory and groups the middle levels", () => {
    const ctx = articleContext(MIXED);
    expect(ctx).toMatchObject({ prefix: 1, sameFile: true });
    expect(articleLabel(MIXED[0], ctx)).toEqual({ name: "intro", group: [], file: null });
    expect(articleLabel(MIXED[1], ctx)).toEqual({ name: "setup", group: ["author-b"], file: null });
    expect(articleLabel(MIXED[2], ctx)).toEqual({ name: "tips", group: ["author-b"], file: null });
    expect(articleLabel(MIXED[3], ctx)).toEqual({ name: "c", group: ["a", "b"], file: null });
  });

  it("uses the file name without .typ for a file at the root", () => {
    const ctx = articleContext(["main.typ", "articles/x/article.typ"]);
    expect(articleLabel("main.typ", ctx)).toEqual({ name: "main", group: [], file: null });
    expect(articleLabel("main.typ")).toEqual({ name: "main", group: [], file: null });
  });

  it("shows the file name when it differs between articles", () => {
    const paths = ["articles/x/part1.typ", "articles/y/part2.typ"];
    const ctx = articleContext(paths);
    expect(ctx.sameFile).toBe(false);
    expect(articleLabel(paths[0], ctx)).toEqual({ name: "x", group: [], file: "part1.typ" });
  });

  it("keeps at least one level for a single article", () => {
    const ctx = articleContext(["articles/intro/article.typ"]);
    expect(ctx).toMatchObject({ prefix: 1, sameFile: true });
    expect(articleLabel("articles/intro/article.typ", ctx)).toEqual({ name: "intro", group: [], file: null });
  });

  it("drops a common group when all articles are under the same second level", () => {
    const paths = ["articles/g/x/article.typ", "articles/g/y/article.typ"];
    const ctx = articleContext(paths);
    expect(ctx.prefix).toBe(2);
    expect(articleLabel(paths[0], ctx)).toEqual({ name: "x", group: [], file: null });
  });

  it("handles Japanese, spaces and long names as they are", () => {
    const long = "a".repeat(60);
    const paths = ["articles/著者 A/はじめに/article.typ", `articles/${long}/article.typ`];
    const ctx = articleContext(paths);
    expect(articleLabel(paths[0], ctx)).toEqual({ name: "はじめに", group: ["著者 A"], file: null });
    expect(articleLabel(paths[1], ctx).name).toBe(long);
  });

  it("without a context, uses the parent directory", () => {
    expect(articleLabel("articles/author-b/setup/article.typ")).toEqual({ name: "setup", group: [], file: null });
  });
});

describe("duplicates", () => {
  it("names articles by file when several share a directory", () => {
    const paths = ["chapters/intro.typ", "chapters/setup.typ", "appendix/notes.typ"];
    const ctx = articleContext(paths);
    expect(articleLabel(paths[0], ctx)).toEqual({ name: "intro", group: ["chapters"], file: null });
    expect(articleLabel(paths[1], ctx)).toEqual({ name: "setup", group: ["chapters"], file: null });
    // 1 つしか無いディレクトリはディレクトリ名のまま
    expect(articleLabel(paths[2], ctx)).toEqual({ name: "appendix", group: [], file: "notes.typ" });
  });

  it("adds the parents to a name that collides, for places outside the list", () => {
    const paths = ["articles/a/x/article.typ", "articles/b/x/article.typ", "articles/b/y/article.typ"];
    const ctx = articleContext(paths);
    expect(articleLabel(paths[0], ctx).name).toBe("x");
    expect(articleTitle(paths[0], ctx)).toBe("a / x");
    expect(articleTitle(paths[1], ctx)).toBe("b / x");
    expect(articleTitle(paths[2], ctx)).toBe("y");
    expect(articleTitle(paths[0])).toBe("x");
  });
});

describe("groupArticles", () => {
  it("groups by heading in path order, with headless articles last under 'その他'", () => {
    const g = groupArticles(MIXED.map((path) => ({ path })));
    expect(g.map((x) => [x.heading, x.items.map((i) => i.label.name)])).toEqual([
      ["a / b", ["c"]],
      ["author-b", ["setup", "tips"]],
      ["その他", ["intro"]],
    ]);
  });

  it("merges a group that is split in the API order and keeps the item order", () => {
    const g = groupArticles(
      ["articles/g1/x/article.typ", "articles/top/article.typ", "articles/g1/a/article.typ"].map((path) => ({ path })),
    );
    expect(g.map((x) => [x.heading, x.items.map((i) => i.label.name)])).toEqual([
      ["g1", ["x", "a"]],
      ["その他", ["top"]],
    ]);
  });

  it("uses no heading at all when no article has one", () => {
    const g = groupArticles(["articles/a/article.typ", "articles/b/article.typ"].map((path) => ({ path })));
    expect(g.map((x) => x.heading)).toEqual([null]);
  });

  it("returns nothing for no articles", () => {
    expect(groupArticles([])).toEqual([]);
  });
});
