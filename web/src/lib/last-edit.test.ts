// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { parseLastEdit, readLastEdit, writeLastEdit } from "./last-edit";

afterEach(() => window.localStorage.clear());

describe("last edit", () => {
  it("round-trips through localStorage", () => {
    expect(readLastEdit()).toBeNull();
    writeLastEdit({ project: "sample-book", article: "articles/a/article.typ", file: "lib.typ" });
    expect(readLastEdit()).toEqual({ project: "sample-book", article: "articles/a/article.typ", file: "lib.typ" });
  });

  it("ignores broken or partial values", () => {
    expect(parseLastEdit("{")).toBeNull();
    expect(parseLastEdit("null")).toBeNull();
    expect(parseLastEdit('{"project":"p"}')).toBeNull();
    expect(parseLastEdit('{"project":"","article":"a","file":"a"}')).toBeNull();
    expect(parseLastEdit('{"project":"p","article":"a","file":""}')).toEqual({ project: "p", article: "a", file: "a" });
  });
});
