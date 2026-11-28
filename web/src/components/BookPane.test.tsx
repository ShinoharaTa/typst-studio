// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookPane, buildSummaryText } from "./BookPane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const RESULT = {
  buildId: "b1",
  profile: "print",
  startedAt: "2026-01-01T00:00:00Z",
  finishedAt: "2026-01-01T00:00:04Z",
  durationMs: 4000,
  ok: true,
  reason: "ok",
  diagnostics: [],
  warnings: 0,
  pdfUrl: "/api/projects/sample-book/builds/print-b1.pdf",
};

class FakeWebSocket {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  send() {}
  close() {}
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input.endsWith("/profiles")) return json({ profiles: ["print", "ebook"], default: "print" });
      if (input.includes("/build?")) return json({ project: "sample-book", profile: "print", state: "idle", last: RESULT, lastSuccess: RESULT, stale: true });
      return json({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("buildSummaryText", () => {
  it("joins the parts on one line and names the failure", () => {
    const failed = { ...RESULT, ok: false, reason: "error" as const, warnings: 2 };
    const t = buildSummaryText({ project: "sample-book", profile: "print", state: "queued", last: failed, stale: false });
    expect(t).toMatch(/^失敗（コンパイルエラー） ・ .+ ・ 4\.0 秒 ・ 警告 2 ・ 待ち 1 件$/);
    expect(t).not.toContain("\n");
    expect(buildSummaryText(null)).toBe("ビルド履歴なし");
  });
});

describe("BookPane", () => {
  it("shows the status on one line and the full text on tap", async () => {
    const failed = { ...RESULT, ok: false, reason: "error", pdfUrl: undefined };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.endsWith("/profiles")) return json({ profiles: ["print"], default: "print" });
        if (input.includes("/build?")) return json({ project: "sample-book", profile: "print", state: "idle", last: failed, stale: false });
        return json({});
      }),
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<BookPane project="sample-book" active={false} onGoto={() => undefined} onDiagnostics={() => undefined} />));
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    const summary = host.querySelector<HTMLButtonElement>(".book-summary")!;
    expect(summary.className).toContain("error");
    expect(summary.dataset.expanded).toBe("false");
    expect(summary.title).toBe(summary.textContent);
    await act(async () => summary.click());
    expect(summary.dataset.expanded).toBe("true");
    await act(async () => root.unmount());
  });

  it("keeps the first row to profile + build; download goes to the PDF bar and auto-build to the status row", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<BookPane project="sample-book" active={false} onGoto={() => undefined} onDiagnostics={() => undefined} />));
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    const bar = host.querySelector(".book-bar")!;
    expect([...bar.children].map((c) => c.tagName)).toEqual(["SELECT", "BUTTON"]);
    expect(host.querySelector(".pdf-bar a[download]")?.getAttribute("href")).toBe(RESULT.pdfUrl);
    expect(host.querySelector(".book-status input[type=checkbox]")).not.toBeNull();
    expect(host.querySelector(".book-status")?.textContent).toContain("未反映の変更あり");
    await act(async () => root.unmount());
  });
});
