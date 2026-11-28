import { describe, expect, it } from "vitest";
import { editImageCall, findImageCallAt, imageCalls, normalizeUploadName, resolveImagePath, sniffImage } from "../src/images.js";
import { MAX_DEPTH, ScanDepthError, scanImageCalls, typstString, unescapeString } from "../src/scan.js";

const P = "articles/author-a/article.typ";
const srcs = (t: string) => imageCalls(t, P).map((c) => c.src);

// 書き換え前後の差分が、呼び出しの引数範囲 ( ... ) の内側に限られることを確かめる
function expectOnlyArgsChanged(before: string, after: string, start: number): void {
  const c = scanImageCalls(before).find((x) => x.start === start)!;
  const tail = before.length - c.argsClose;
  expect(after.slice(0, c.argsOpen + 1)).toBe(before.slice(0, c.argsOpen + 1));
  expect(after.slice(after.length - tail)).toBe(before.slice(c.argsClose));
}

describe("scanImageCalls (spec 4.4)", () => {
  it("extracts the forms used in the sample book", () => {
    const t = [
      '#image("a.png")',
      '#image("b.png", width: 100%)',
      '#image("c.png", width: 70%, alt: "A cat")',
      '#image("d.png", width: 32mm)',
      '#image("e.png", height: 8em)',
    ].join("\n");
    const calls = imageCalls(t, P);
    expect(calls.map((c) => [c.src, c.width, c.height, c.alt, c.editable])).toEqual([
      ["a.png", null, null, null, true],
      ["b.png", "100%", null, null, true],
      ["c.png", "70%", null, "A cat", true],
      ["d.png", "32mm", null, null, true],
      ["e.png", null, "8em", null, true],
    ]);
    expect(calls[2]).toMatchObject({ path: P, line: 3, column: 2, resolved: "articles/author-a/c.png" });
    expect(t.slice(calls[2].start, calls[2].end)).toBe('image("c.png", width: 70%, alt: "A cat")');
  });

  it("does not pick up image( in strings, comments or raw", () => {
    const t = [
      '// #image("c1.png")',
      '/* outer /* #image("c2.png") */ still comment #image("c3.png") */',
      '#let s = "image(\\"s1.png\\")"',
      '`#image("r1.png")` and ```typ',
      '#image("r2.png")',
      "```",
      '#{ let s = "image(\\"s2.png\\")"; image("code.png") }',
      '#image("ok.png")',
    ].join("\n");
    expect(srcs(t)).toEqual(["code.png", "ok.png"]);
  });

  it("follows nested parentheses and content blocks", () => {
    const t = [
      '#figure(image("fig.png", width: calc.min(50, (1 + 2)) * 1%), caption: [A #image("inline.png") [nested]])',
      '#box[#grid(columns: (1fr, 1fr), image("g1.png"), [#image("g2.png")])]',
      '#image("after.png")',
    ].join("\n");
    const calls = imageCalls(t, P);
    expect(calls.map((c) => c.src)).toEqual(["fig.png", "inline.png", "g1.png", "g2.png", "after.png"]);
    expect(calls[0].width).toBe("calc.min(50, (1 + 2)) * 1%");
  });

  it("treats quotes in markup as text, and // in links as part of the link", () => {
    const t = ['He said "image(" is #image("a.png").', 'See https://example.com/x//y #image("b.png")', '5" long #image("c.png")'].join("\n");
    expect(srcs(t)).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("does not count set rules, field access or other identifiers", () => {
    const t = ['#set image(width: 50%)', '#x.image("no1.png")', '#myimage("no2.png")', "image(\"plain text\")", '#image.decode("<svg/>")'].join("\n");
    expect(imageCalls(t, P)).toEqual([]);
  });

  it("finds calls in code blocks, math, show rules and if/else", () => {
    const t = [
      '#show heading: it => [#it.body #image("show.png")]',
      '#if true [#image("then.png")] else { image("else.png") }',
      '$ x #image("math.png") $',
      '#context image("ctx.png")',
      'text after #image("tail.png")',
    ].join("\n");
    expect(srcs(t)).toEqual(["show.png", "then.png", "else.png", "math.png", "ctx.png", "tail.png"]);
  });

  it("marks non-literal first arguments as not editable", () => {
    const t = ['#let p = "x.png"', "#image(p, width: 100%)", '#image("pre-" + p, width: 10%)', '#image(width: 16mm, "late.png")'].join("\n");
    const calls = imageCalls(t, P);
    expect(calls.map((c) => [c.src, c.editable, c.width])).toEqual([
      [null, false, "100%"],
      [null, false, "10%"],
      ["late.png", true, "16mm"],
    ]);
  });

  it("keeps an alt that is not a literal as source text, and unescapes literals", () => {
    const t = '#image("a.png", alt: "say \\"hi\\" \\u{1F600}")\n#image("b.png", alt: caption)';
    expect(imageCalls(t, P).map((c) => c.alt)).toEqual(['say "hi" 😀', "caption"]);
  });

  it("returns 1-based line and UTF-16 column", () => {
    const t = '日本語 😀 #image("a.png")';
    const [c] = imageCalls(t, P);
    expect(c.line).toBe(1);
    expect(c.column).toBe(t.indexOf("image") + 1);
  });

  it("reads a named argument with a comment before the colon, and does not duplicate it", () => {
    const t = '#image("a.png", width /* c */ : 5%)';
    const [c] = imageCalls(t, P);
    expect(c.width).toBe("5%");
    expect(editImageCall(t, P, c.start, { width: "6%" }).content).toBe('#image("a.png", width /* c */ : 6%)');
  });

  it("does not list let image(...) = definitions", () => {
    expect(srcs('#let image(src, w: 1) = box(src)\n#image("a.png")')).toEqual(["a.png"]);
  });

  it("counts \\r\\n, \\r, U+0085, U+2028 and U+2029 as line breaks like typst", () => {
    const t = 'a\r\nb\rc\u0085d\u2028e\u2029#image("a.png") // c\u2028#image("b.png")';
    const calls = imageCalls(t, P);
    expect(calls.map((c) => [c.src, c.line, c.column])).toEqual([
      ["a.png", 6, 2],
      ["b.png", 7, 2],
    ]);
    // 改行で終わる文（#let）
    expect(srcs('#let x = 1\u2028#image("c.png")')).toEqual(["c.png"]);
  });

  it("throws ScanDepthError instead of RangeError on deep nesting", () => {
    for (const t of ["#" + "(".repeat(200000), "#f" + "[#f".repeat(100000), "#image(" + "image(".repeat(50000), "#context context ".repeat(1) + "context ".repeat(100000)]) {
      expect(() => scanImageCalls(t)).toThrow(ScanDepthError);
    }
    expect(scanImageCalls("#" + "(".repeat(MAX_DEPTH - 10) + 'image("a.png")')).toHaveLength(1);
    expect(() => editImageCall("#" + "(".repeat(200000), P, 0, { width: "1%" })).toThrow(/cannot be scanned/);
  });

  it("does not make an unclosed call editable", () => {
    expect(imageCalls('#image("a.png", width: 50%', P)[0].editable).toBe(false);
  });
});

describe("resolveImagePath", () => {
  it("resolves relative to the .typ file, or the root for /", () => {
    expect(resolveImagePath(P, "images/a.png")).toBe("articles/author-a/images/a.png");
    expect(resolveImagePath(P, "../shared/b.png")).toBe("articles/shared/b.png");
    expect(resolveImagePath(P, "/assets/c.png")).toBe("assets/c.png");
    expect(resolveImagePath(P, "../../../out.png")).toBeNull();
    expect(resolveImagePath(P, "/../out.png")).toBeNull();
  });
});

describe("editImageCall (spec 4.4)", () => {
  const before = ["= Title", "", "Text before.", '#image("a.png", width: 70%, alt: "old")', "", '#image("b.png")', "Text after."].join("\n");
  const startOf = (t: string, src: string) => imageCalls(t, P).find((c) => c.src === src)!.start;

  it("replaces only the value of an existing width", () => {
    const s = startOf(before, "a.png");
    const { content, call } = editImageCall(before, P, s, { width: "85%" });
    expect(content).toBe(before.replace("width: 70%", "width: 85%"));
    expect(call).toMatchObject({ start: s, width: "85%", alt: "old" });
    expectOnlyArgsChanged(before, content, s);
  });

  it("adds a width to a call without one", () => {
    const s = startOf(before, "b.png");
    const { content, call } = editImageCall(before, P, s, { width: "100%" });
    expect(content).toBe(before.replace('#image("b.png")', '#image("b.png", width: 100%)'));
    expect(call.width).toBe("100%");
    expectOnlyArgsChanged(before, content, s);
  });

  it("removes arguments with their separator", () => {
    const s = startOf(before, "a.png");
    expect(editImageCall(before, P, s, { width: null }).content).toContain('#image("a.png", alt: "old")');
    expect(editImageCall(before, P, s, { alt: null }).content).toContain('#image("a.png", width: 70%)');
    const both = editImageCall(before, P, s, { width: null, alt: null }).content;
    expect(both).toContain('#image("a.png")');
    expectOnlyArgsChanged(before, both, s);
  });

  it("writes alt as an escaped string literal", () => {
    const s = startOf(before, "a.png");
    const { content, call } = editImageCall(before, P, s, { alt: 'a "quote" \\ and\nnewline' });
    expect(content).toContain('alt: "a \\"quote\\" \\\\ and\\nnewline"');
    expect(call.alt).toBe('a "quote" \\ and\nnewline');
    expectOnlyArgsChanged(before, content, s);
  });

  it("sets several arguments at once and keeps multi-line formatting of the rest", () => {
    const t = ['#figure(', "  image(", '    "a.png",', "    width: 50%, // keep this comment", "  ),", ")"].join("\n");
    const s = startOf(t, "a.png");
    const { content, call } = editImageCall(t, P, s, { width: "60%", height: "3cm", alt: "x" });
    expect(content).toBe(['#figure(', "  image(", '    "a.png",', '    width: 60%, height: 3cm, alt: "x", // keep this comment', "  ),", ")"].join("\n"));
    expect(call).toMatchObject({ width: "60%", height: "3cm", alt: "x" });
    expectOnlyArgsChanged(t, content, s);
  });

  it("does not touch the other calls or lines", () => {
    const t = '#image("a.png", width: 10%) #image("a.png", width: 10%)\nline 2';
    const second = imageCalls(t, P)[1].start;
    const { content } = editImageCall(t, P, second, { width: "20%" });
    expect(content).toBe('#image("a.png", width: 10%) #image("a.png", width: 20%)\nline 2');
  });

  it("refuses non-literal calls and positions without a call", () => {
    const t = "#image(path, width: 10%)";
    expect(() => editImageCall(t, P, 1, { width: "20%" })).toThrow(/no editable image\(\) call/);
    expect(() => editImageCall(before, P, 0, { width: "20%" })).toThrow(/no editable image\(\) call/);
  });
});

describe("findImageCallAt", () => {
  const t = ["para 1", '#image("a.png", width: 50%)', "para 3", "para 4", "para 5", "para 6", "para 7", "para 8"].join("\n");
  const calls = imageCalls(t, P);
  it("returns the call containing the offset", () => {
    const c = findImageCallAt(t, calls, calls[0].start + 3);
    expect(c?.src).toBe("a.png");
    expect(c?.nearest).toBeUndefined();
  });
  it("returns the nearest call within 3 lines, marked nearest", () => {
    expect(findImageCallAt(t, calls, t.indexOf("para 3"))).toMatchObject({ src: "a.png", nearest: true });
    expect(findImageCallAt(t, calls, t.indexOf("para 5"))).toMatchObject({ src: "a.png", nearest: true });
    expect(findImageCallAt(t, calls, t.indexOf("para 6"))).toBeUndefined();
  });
});

describe("string helpers", () => {
  it("round-trips Typst string literals", () => {
    for (const v of ["plain", 'q"uote', "back\\slash", "tab\tnl\n", "日本語"]) expect(unescapeString(typstString(v))).toBe(v);
  });
});

describe("upload helpers (spec 4.5)", () => {
  it("normalizes names to lower-case letters, digits and hyphens", () => {
    expect(normalizeUploadName("My Photo (1).PNG")).toEqual({ stem: "my-photo-1", ext: "png" });
    expect(normalizeUploadName("../../etc/x.jpeg")).toEqual({ stem: "x", ext: "jpeg" });
    expect(normalizeUploadName("写真.webp")).toEqual({ stem: "image", ext: "webp" });
    expect(() => normalizeUploadName("a.exe")).toThrow(/only png/);
  });
  it("detects formats from magic numbers", () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImage(Buffer.from('<?xml version="1.0"?>\n<!-- c --><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("svg");
    expect(sniffImage(Buffer.from("GIF89a"))).toBeNull();
  });
});
