import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, ConflictError, NoMemoryError } from "./client";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[];
let reply: () => Response;

beforeEach(() => {
  calls = [];
  reply = () => new Response(null, { status: 204 });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body });
    return reply();
  });
});

afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  it("encodes project names and paths", async () => {
    reply = () => json(200, { path: "articles/a b/article.typ", content: "x", rev: "r1" });
    const f = await api.readFile("sample-book", "articles/a b/article.typ");
    expect(f.rev).toBe("r1");
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/projects/sample-book/file?path=articles%2Fa%20b%2Farticle.typ" });
    await api.articles("x/../y");
    expect(calls[1].url).toBe("/api/projects/x%2F..%2Fy/articles");
  });

  it("sends JSON bodies with baseRev", async () => {
    reply = () => json(200, { rev: "r2" });
    expect(await api.writeFile("sample-book", "main.typ", "= A\n", "r1")).toEqual({ rev: "r2" });
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].headers["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0].body as string)).toEqual({ path: "main.typ", content: "= A\n", baseRev: "r1" });
  });

  it("turns 409 with rev/content into ConflictError", async () => {
    reply = () => json(409, { error: "rev mismatch", rev: "disk", content: "on disk" });
    const e = await api.writeFile("sample-book", "main.typ", "mine", "old").catch((x) => x);
    expect(e).toBeInstanceOf(ConflictError);
    expect(e).toMatchObject({ status: 409, rev: "disk", content: "on disk", message: "rev mismatch" });
  });

  it("turns 409 for a removed or unreadable file into ConflictError with nulls", async () => {
    reply = () => json(409, { error: "no longer exists", rev: null, content: null });
    const gone = await api.writeFile("sample-book", "main.typ", "mine", "old").catch((x) => x);
    expect(gone).toBeInstanceOf(ConflictError);
    expect(gone).toMatchObject({ rev: null, content: null });
    reply = () => json(409, { error: "changed", rev: "big", content: null });
    expect(await api.writeFile("sample-book", "main.typ", "mine", "old").catch((x) => x)).toMatchObject({ rev: "big", content: null });
  });

  it("adds keepalive only for small bodies", async () => {
    reply = () => json(200, { rev: "r" });
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => (seen.push(init), reply()));
    await api.writeFile("sample-book", "a.typ", "x", "r0", { keepalive: true });
    await api.writeFile("sample-book", "a.typ", "x".repeat(70_000), "r0", { keepalive: true });
    await api.writeFile("sample-book", "a.typ", "x", "r0");
    expect(seen.map((i) => i.keepalive)).toEqual([true, undefined, undefined]);
  });

  it("keeps other 409s (e.g. preview not running) as plain ApiError", async () => {
    reply = () => json(409, { error: "preview is not running" });
    const e = await api.previewMemory("sample-book", "main.typ", "x").catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).not.toBeInstanceOf(ConflictError);
    expect(e.message).toBe("preview is not running");
  });

  it("turns 503 nomem into NoMemoryError and sends stopPreview only when asked", async () => {
    reply = () => json(503, { error: "not enough memory", reason: "nomem", available: 100, required: 200 });
    const e = await api.build("sample-book", "print").catch((x) => x);
    expect(e).toBeInstanceOf(NoMemoryError);
    expect(e).toMatchObject({ available: 100, required: 200 });
    expect(JSON.parse(calls[0].body as string)).toEqual({ profile: "print" });
    await api.build("sample-book", "print", true).catch(() => undefined);
    expect(JSON.parse(calls[1].body as string)).toEqual({ profile: "print", stopPreview: true });
    expect(calls[1]).toMatchObject({ method: "POST", url: "/api/projects/sample-book/build" });
  });

  it("returns undefined for 204", async () => {
    expect(await api.previewScroll("sample-book", "main.typ", 3, 0)).toBeUndefined();
    expect(JSON.parse(calls[0].body as string)).toEqual({ project: "sample-book", path: "main.typ", line: 3, character: 0 });
  });

  it("uses the status text when the error body is not JSON", async () => {
    reply = () => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" });
    const e = await api.projects().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 502, message: "502 Bad Gateway" });
  });

  it("PATCHes images with dryRun for previews and without it for apply", async () => {
    reply = () => json(200, { content: "c", call: {} });
    const body = { path: "a.typ", baseRev: "r", start: 10, set: { width: "50%" } };
    await api.previewImage("sample-book", body);
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "/api/projects/sample-book/images" });
    expect(JSON.parse(calls[0].body as string)).toEqual({ ...body, dryRun: true });
    reply = () => json(200, { rev: "r2", call: {} });
    await api.patchImage("sample-book", body);
    expect(JSON.parse(calls[1].body as string)).toEqual(body);
  });

  it("uploads the raw file with its name in the query", async () => {
    reply = () => json(201, { path: "articles/a/images/x.png", insert: '#image("images/x.png", width: 100%)' });
    const file = new File([new Uint8Array([0x89, 0x50])], "My Photo.PNG", { type: "image/png" });
    const r = await api.upload("sample-book", "articles/a/article.typ", file);
    expect(r.path).toBe("articles/a/images/x.png");
    expect(calls[0].url).toBe("/api/projects/sample-book/upload?article=articles%2Fa%2Farticle.typ&name=My%20Photo.PNG");
    expect(calls[0].headers["content-type"]).toBe("image/png");
    expect(calls[0].body).toBe(file);
  });

  it("builds raw and status URLs", async () => {
    expect(api.rawUrl("sample-book", "images/a b.png")).toBe("/api/projects/sample-book/raw?path=images%2Fa%20b.png");
    reply = () => json(200, { project: "sample-book", profile: "e book", state: "idle", stale: false });
    await api.buildStatus("sample-book", "e book");
    expect(calls[0].url).toBe("/api/projects/sample-book/build?profile=e%20book");
  });
});
