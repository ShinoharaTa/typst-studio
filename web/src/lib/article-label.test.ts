import { describe, expect, it } from "vitest";
import { articleContext, articleLabel, groupArticles } from "./article-label";

const MIXED = [
  "articles/intro/article.typ",
  "articles/author-b/setup/article.typ",
  "articles/author-b/tips/article.typ",
  "articles/a/b/c/article.typ",
];

describe("articleLabel", () => {
  it("names articles by their directory and groups the middle levels", () => {
    const ctx = articleContext(MIXED);
    expect(ctx).toEqual({ prefix: 1, sameFile: true });
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
    expect(ctx).toEqual({ prefix: 1, sameFile: true });
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

describe("groupArticles", () => {
  it("groups consecutive articles with the same heading, keeping the order", () => {
    const g = groupArticles(MIXED.map((path) => ({ path })));
    expect(g.map((x) => [x.group.join(" / "), x.items.map((i) => i.label.name)])).toEqual([
      ["", ["intro"]],
      ["author-b", ["setup", "tips"]],
      ["a / b", ["c"]],
    ]);
  });

  it("returns nothing for no articles", () => {
    expect(groupArticles([])).toEqual([]);
  });
});
