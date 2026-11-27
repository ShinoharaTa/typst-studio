import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute, type Route } from "./route";

describe("routes", () => {
  it("round-trips", () => {
    const routes: Route[] = [
      { view: "projects" },
      { view: "articles", project: "sample-book" },
      { view: "edit", project: "sample-book", article: "articles/author-a/article.typ", file: "articles/author-a/article.typ", tab: "edit" },
      { view: "edit", project: "sample-book", article: "articles/a b/article.typ", file: "lib/common.typ", tab: "book" },
    ];
    for (const r of routes) expect(parseRoute(formatRoute(r))).toEqual(r);
  });

  it("omits defaults from the URL", () => {
    expect(
      formatRoute({ view: "edit", project: "sample-book", article: "a.typ", file: "a.typ", tab: "edit" }),
    ).toBe("#/p/sample-book/edit/a.typ");
  });

  it("falls back to the project list for unknown or broken hashes", () => {
    expect(parseRoute("")).toEqual({ view: "projects" });
    expect(parseRoute("#/zzz")).toEqual({ view: "projects" });
    expect(parseRoute("#/p/%E0%A4%A")).toEqual({ view: "projects" });
  });

  it("accepts an unencoded article path and an unknown tab", () => {
    expect(parseRoute("#/p/sample-book/edit/articles/x/article.typ?tab=nope")).toEqual({
      view: "edit",
      project: "sample-book",
      article: "articles/x/article.typ",
      file: "articles/x/article.typ",
      tab: "edit",
    });
  });
});
