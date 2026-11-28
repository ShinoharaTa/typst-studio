// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

// 編集画面を出る・切り替えるときの保存（アンマウントを含む回帰テスト）

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Put {
  path: string;
  content: string;
  baseRev: string | null;
}

let files: Record<string, { content: string; rev: string }>;
let puts: Put[];
let putReply: ((p: Put) => Response | Promise<Response>) | null;
let root: Root | null;
let host: HTMLDivElement;
// 2 ペイン（min-width: 900px）として振る舞わせる
let wideMode = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const STOPPED = { state: "stopped", project: null, article: null, startedAt: null, viewers: 0, lastError: null, compile: null };

async function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, "http://studio.test");
  const method = init.method ?? "GET";
  if (url.pathname === "/api/projects")
    return json(200, [{ name: "sample-book", branch: "main", detached: false, head: "0", uncommitted: 0, unpushed: 0, upstream: "origin/main" }]);
  if (url.pathname === "/api/preview/status" || url.pathname === "/api/preview/start") return json(200, STOPPED);
  if (url.pathname.endsWith("/profiles")) return json(200, { profiles: [], default: null });
  if (url.pathname.endsWith("/articles")) return json(200, [{ path: "a.typ" }, { path: "b.typ" }]);
  if (url.pathname.endsWith("/images")) return json(200, { rev: "x", calls: [] });
  if (url.pathname.endsWith("/file") && method === "GET") {
    const f = files[url.searchParams.get("path")!];
    return f ? json(200, { path: url.searchParams.get("path"), ...f }) : json(404, { error: "not found" });
  }
  if (url.pathname.endsWith("/file") && method === "PUT") {
    const p = JSON.parse(String(init.body)) as Put;
    puts.push(p);
    if (putReply) return putReply(p);
    const rev = `r${puts.length}`;
    files[p.path] = { content: p.content, rev };
    return json(200, { rev });
  }
  if (url.pathname.startsWith("/api/preview/")) return new Response(null, { status: 204 });
  return json(404, { error: "unexpected" });
}

class FakeWebSocket {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  send() {}
  close() {}
}

const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await tick();
  }
  throw new Error(`timed out: ${what}`);
}

async function go(hash: string) {
  await act(async () => {
    window.location.hash = hash;
  });
  // hashchange は非同期に届く
  for (let i = 0; i < 5; i++) await tick();
}

const view = () => EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement)!;
const docText = () => view().state.doc.toString();

function type(text: string) {
  act(() => {
    const v = view();
    v.dispatch({ changes: { from: 0, insert: text } });
  });
}

async function openEditor(path = "a.typ") {
  await go(`#/p/sample-book/edit/${path}`);
  if (!root) {
    root = createRoot(host);
    await act(async () => root!.render(<App />));
  }
  await until(() => !!host.querySelector(".cm-editor") && docText() === files[path].content, "file loaded");
}

beforeEach(() => {
  files = { "a.typ": { content: "= A\n", rev: "ra" }, "b.typ": { content: "= B\n", rev: "rb" } };
  puts = [];
  putReply = null;
  wideMode = false;
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // 本のタブを開くと PDF のビューアが作られる（jsdom に無い）
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: wideMode && q.includes("min-width: 900px"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  // CodeMirror の計測を jsdom で通す
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  host = document.createElement("div");
  document.body.append(host);
  root = null;
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host.remove();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("leaving the editor", () => {
  it("does not overwrite the file when leaving without edits", async () => {
    await openEditor();
    await go("#/p/sample-book");
    await until(() => !host.querySelector(".cm-editor"), "editor closed");
    await tick();
    expect(puts).toEqual([]);
    expect(files["a.typ"].content).toBe("= A\n");
  });

  it("does not overwrite the file when the whole app unmounts", async () => {
    await openEditor();
    await act(async () => root!.unmount());
    root = null;
    await tick();
    expect(puts).toEqual([]);
  });

  it("saves the edited content (never an empty string) before leaving", async () => {
    await openEditor();
    type("X");
    await go("#/p/sample-book");
    await until(() => !host.querySelector(".cm-editor"), "editor closed");
    expect(puts).toEqual([{ path: "a.typ", content: "X= A\n", baseRev: "ra" }]);
  });

  it("saves the old file with its own content when switching to another article", async () => {
    await openEditor("a.typ");
    type("X");
    await go("#/p/sample-book/edit/b.typ");
    await until(() => !!host.querySelector(".cm-editor") && docText() === "= B\n", "b opened");
    expect(puts).toEqual([{ path: "a.typ", content: "X= A\n", baseRev: "ra" }]);
    expect(files["b.typ"].content).toBe("= B\n");
  });

  it("stays on the editor and keeps the edits when the save conflicts", async () => {
    await openEditor();
    type("X");
    putReply = () => json(409, { error: "changed on disk", rev: "rDisk", content: "= other\n" });
    await go("#/p/sample-book");
    await until(() => document.body.textContent?.includes("ディスク側が変わった") ?? false, "conflict dialog");
    expect(host.querySelector(".cm-editor")).not.toBeNull();
    expect(docText()).toBe("X= A\n");
    expect(window.location.hash).toBe("#/p/sample-book/edit/a.typ");
    // 開いた直後のフォーカスはダイアログ本体（どちらのボタンも内容を捨てるので、ボタンには当てない）
    const dialog = document.querySelector<HTMLElement>("[data-slot=alert-dialog]")!;
    await until(() => document.activeElement === dialog, "focus on the dialog");
    expect(document.activeElement?.tagName).not.toBe("BUTTON");
  });

  it("shrinks the tab labels to caption while the keyboard is shown, only in one-pane", async () => {
    await openEditor();
    const tabs = [...host.querySelectorAll<HTMLElement>(".view-tabs .tab")];
    expect(tabs.length).toBe(4);
    for (const t of tabs) expect(t.className.split(" ")).toEqual(expect.arrayContaining(["kb:text-caption", "kb:flex-auto"]));
  });

  it("stays on the editor when the save fails on the network", async () => {
    await openEditor();
    type("X");
    putReply = () => {
      throw new TypeError("Failed to fetch");
    };
    await go("#/p/sample-book");
    await tick();
    expect(host.querySelector(".cm-editor")).not.toBeNull();
    expect(docText()).toBe("X= A\n");
    expect(window.location.hash).toBe("#/p/sample-book/edit/a.typ");
    // 回線が戻れば移動できる
    putReply = null;
    await go("#/p/sample-book");
    await until(() => !host.querySelector(".cm-editor"), "editor closed");
    expect(puts.at(-1)).toEqual({ path: "a.typ", content: "X= A\n", baseRev: "ra" });
  });

  it("keeps the history as [list, editor] when Back is stopped", async () => {
    await go("#/p/sample-book");
    root = createRoot(host);
    await act(async () => root!.render(<App />));
    await until(() => !!host.querySelector("[data-slot=list-item]"), "article list");
    await go("#/p/sample-book/edit/a.typ");
    await until(() => !!host.querySelector(".cm-editor") && docText() === "= A\n", "file loaded");
    const len = window.history.length;
    type("X");
    putReply = () => {
      throw new TypeError("Failed to fetch");
    };
    await act(async () => window.history.back());
    for (let i = 0; i < 10; i++) await tick();
    expect(window.location.hash).toBe("#/p/sample-book/edit/a.typ");
    expect(host.querySelector(".cm-editor")).not.toBeNull();
    expect(window.history.length).toBe(len);
    // 保存できるようになれば、もう一度の「戻る」で一覧へ（一覧のエントリが残っている）
    putReply = null;
    await act(async () => window.history.back());
    await until(() => !host.querySelector(".cm-editor"), "editor closed");
    expect(window.location.hash).toBe("#/p/sample-book");
    expect(puts.at(-1)).toEqual({ path: "a.typ", content: "X= A\n", baseRev: "ra" });
  });

  it("ignores a pending save result when the URL returns to the editor meanwhile", async () => {
    await openEditor();
    type("X");
    let release!: (r: Response) => void;
    // PUT の応答を待たせる
    const pending = new Promise<Response>((r) => (release = r));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit = {}) => {
        if (String(input).endsWith("/file") && init.method === "PUT") {
          puts.push(JSON.parse(String(init.body)) as Put);
          return pending;
        }
        return fakeFetch(input, init);
      }),
    );
    await go("#/p/sample-book");
    expect(host.querySelector(".cm-editor")).not.toBeNull(); // 保存待ち
    await go("#/p/sample-book/edit/a.typ"); // 待っている間に元の URL へ
    await act(async () => release(json(200, { rev: "r9" })));
    for (let i = 0; i < 10; i++) await tick();
    expect(host.querySelector(".cm-editor")).not.toBeNull();
    expect(window.location.hash).toBe("#/p/sample-book/edit/a.typ");
  });

  it("swaps the two panes with CSS order, keeping the panes mounted and remembering it", async () => {
    wideMode = true;
    await openEditor();
    const screen = () => host.querySelector(".editor-screen") as HTMLElement;
    const btn = () => host.querySelector<HTMLButtonElement>(".swap-btn");
    const preview = host.querySelector(".pane-preview");
    const editorDom = host.querySelector(".cm-editor");
    expect(screen().dataset.swap).toBe("false");
    await act(async () => btn()!.click());
    expect(screen().dataset.swap).toBe("true");
    expect(btn()!.getAttribute("aria-pressed")).toBe("true");
    // DOM は作り直さない（プレビューの iframe やエディタの状態が残る）
    expect(host.querySelector(".pane-preview")).toBe(preview);
    expect(host.querySelector(".cm-editor")).toBe(editorDom);
    expect(window.localStorage.getItem("typst-studio.paneOrder")).toBe("edit-right");
    // 別の記事を開いても続く
    await go("#/p/sample-book/edit/b.typ");
    await until(() => !!host.querySelector(".cm-editor") && docText() === "= B\n", "b opened");
    expect(screen().dataset.swap).toBe("true");
  });

  it("does not show the swap button in one-pane mode", async () => {
    await openEditor();
    expect(host.querySelector(".swap-btn")).toBeNull();
  });

  const tabLabels = (nav: Element | null) => [...(nav?.querySelectorAll(".tab") ?? [])].map((b) => b.textContent);

  it("puts the view tabs in the header in one-pane mode (after the title, not at the bottom)", async () => {
    await openEditor();
    const navs = host.querySelectorAll(".view-tabs");
    expect(navs).toHaveLength(1);
    // ヘッダの中、題の後（ペインより前。下端には置かない）
    expect(navs[0].parentElement?.classList.contains("topbar")).toBe(true);
    expect(navs[0].previousElementSibling?.classList.contains("topbar-main")).toBe(true);
    expect(tabLabels(navs[0])).toEqual(["編集", "プレビュー", "本", "画像"]);
    // 編集の入力補助はエディタと同じペインの中
    expect(host.querySelector(".pane-edit .edit-toolbar")).not.toBeNull();
  });

  it("puts the view tabs in the side column of the header in two-pane mode", async () => {
    wideMode = true;
    await openEditor();
    expect(host.querySelectorAll(".view-tabs")).toHaveLength(1);
    expect(tabLabels(host.querySelector(".topbar .view-tabs"))).toEqual(["プレビュー", "本", "画像"]);
    // 2 ペインではキーボード表示中もタブの文字を小さくしない
    for (const t of host.querySelectorAll(".view-tabs .tab")) expect(t.className).not.toContain("kb:text-caption");
  });

  const tabButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".tab")].find((b) => b.textContent === label)!;
  const pressed = () => [...host.querySelectorAll(".tab")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
  const activePanes = () =>
    [...host.querySelectorAll<HTMLElement>(".pane")].filter((p) => p.dataset.active === "true").map((p) => p.getAttribute("aria-label"));

  it("clicking a tab in one-pane mode shows only that pane, marks the tab and puts the tab in the URL", async () => {
    await openEditor();
    expect(activePanes()).toEqual(["編集"]);
    expect(pressed()).toEqual(["編集"]);
    for (const [label, tab] of [
      ["プレビュー", "preview"],
      ["本", "book"],
      ["画像", "images"],
    ] as const) {
      await act(async () => tabButton(label).click());
      for (let i = 0; i < 5; i++) await tick();
      expect(activePanes()).toEqual([label]);
      expect(pressed()).toEqual([label]);
      expect(window.location.hash).toBe(`#/p/sample-book/edit/a.typ?tab=${tab}`);
    }
    await act(async () => tabButton("編集").click());
    for (let i = 0; i < 5; i++) await tick();
    expect(activePanes()).toEqual(["編集"]);
    expect(pressed()).toEqual(["編集"]);
    expect(window.location.hash).toBe("#/p/sample-book/edit/a.typ");
  });

  it("clicking a tab in two-pane mode switches only the side pane (the editor stays shown)", async () => {
    wideMode = true;
    await openEditor();
    expect(activePanes()).toEqual(["編集", "プレビュー"]);
    expect(pressed()).toEqual(["プレビュー"]);
    await act(async () => tabButton("本").click());
    for (let i = 0; i < 5; i++) await tick();
    expect(activePanes()).toEqual(["編集", "本"]);
    expect(pressed()).toEqual(["本"]);
    expect(window.location.hash).toBe("#/p/sample-book/edit/a.typ?tab=book");
    await act(async () => tabButton("画像").click());
    for (let i = 0; i < 5; i++) await tick();
    expect(activePanes()).toEqual(["編集", "画像"]);
    expect(pressed()).toEqual(["画像"]);
    expect(window.location.hash).toBe("#/p/sample-book/edit/a.typ?tab=images");
  });

  it("offers 'continue' on the project list and marks the last article", async () => {
    await openEditor("b.typ");
    await go("#/");
    await until(() => !!host.querySelector(".continue-card"), "continue card");
    const card = host.querySelector<HTMLAnchorElement>(".continue-card")!;
    expect(card.textContent).toContain("sample-book / b");
    expect(card.getAttribute("href")).toBe("#/p/sample-book/edit/b.typ");
    await go("#/p/sample-book");
    await until(() => !!host.querySelector(".last-pill"), "last pill");
    expect(host.querySelector(".last-pill")!.closest("a")!.getAttribute("title")).toBe("b.typ");
  });

  it("the article pill brings you back from another file to the article", async () => {
    await openEditor("a.typ");
    await go("#/p/sample-book/edit/a.typ?file=b.typ");
    await until(() => docText() === "= B\n", "b opened");
    const pill = host.querySelector<HTMLButtonElement>(".article-pill")!;
    expect(pill.textContent).toBe("記事: a");
    await act(async () => pill.click());
    for (let i = 0; i < 5; i++) await tick();
    await until(() => docText() === "= A\n", "back to the article");
    expect(window.location.hash).toBe("#/p/sample-book/edit/a.typ");
    expect(host.querySelector(".article-pill")).toBeNull();
  });

  it("switching tabs does not save or block", async () => {
    await openEditor();
    type("X");
    await go("#/p/sample-book/edit/a.typ?tab=preview");
    expect(puts).toEqual([]);
    expect(host.querySelector(".cm-editor")).not.toBeNull();
  });
});

describe("save state", () => {
  const saveBtn = () => host.querySelector<HTMLButtonElement>(".tb-save")!;
  const clickSave = () => act(async () => saveBtn().click());

  it("shows a failed write on Save and in the header, and keeps it while typing on until a save succeeds", async () => {
    await openEditor();
    type("X");
    putReply = () => {
      throw new TypeError("Failed to fetch");
    };
    await clickSave();
    await until(() => saveBtn().dataset.state === "error", "save error");
    expect(host.querySelector(".save-error")?.textContent).toBe("保存できません");
    // 1 文字打っても、失敗の見た目は消えない
    type("Y");
    await tick();
    expect(saveBtn().dataset.state).toBe("error");
    expect(saveBtn().getAttribute("aria-disabled")).toBe("false");
    expect(host.querySelector(".save-error")).not.toBeNull();
    // 回線が戻って保存できたら消える
    putReply = null;
    await clickSave();
    await until(() => saveBtn().dataset.state === "clean", "saved");
    expect(host.querySelector(".save-state")).toBeNull();
    expect(files["a.typ"].content).toBe("YX= A\n");
  });

  it("shows nothing in the header while dirty or saving", async () => {
    await openEditor();
    expect(saveBtn().dataset.state).toBe("clean");
    type("X");
    await tick();
    expect(saveBtn().dataset.state).toBe("dirty");
    expect(host.querySelector(".save-state")).toBeNull();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    putReply = async (p) => {
      await held;
      files[p.path] = { content: p.content, rev: "r1" };
      return json(200, { rev: "r1" });
    };
    await clickSave();
    await until(() => puts.length === 1, "write started");
    // 「保存中」を出すまでは「保存」の見た目のまま（押せる見た目と aria-disabled を合わせる）。ヘッダには何も出さない
    expect(saveBtn().textContent).toBe("保存");
    expect(saveBtn().getAttribute("aria-disabled")).toBe("false");
    expect(host.querySelector(".save-state")).toBeNull();
    release();
    await until(() => saveBtn().dataset.state === "clean", "saved");
    expect(host.querySelector(".save-state")).toBeNull();
  });

  it("shows the save-error toast once per failure streak, and removes it when a save succeeds", async () => {
    await openEditor();
    // トーストの置き場は前のテストのものも残っているので、保存の失敗のものだけ数える
    const toasts = () =>
      [...document.querySelectorAll("[data-sonner-toast]:not([data-removed='true'])")].filter((e) =>
        e.textContent?.startsWith("保存できません:"),
      ).length;
    type("X");
    putReply = () => {
      throw new TypeError("Failed to fetch");
    };
    await clickSave();
    await until(() => saveBtn().dataset.state === "error", "save error");
    await until(() => toasts() === 1, "toast shown");
    // 打ち続けて保存が何度失敗しても、トーストは出し直さない・重ねない
    for (const ch of ["Y", "Z"]) {
      type(ch);
      const n = puts.length;
      await clickSave();
      await until(() => puts.length === n + 1 && saveBtn().dataset.state === "error", "failed again");
      for (let i = 0; i < 3; i++) await tick();
      expect(toasts()).toBe(1);
    }
    putReply = null;
    await clickSave();
    await until(() => saveBtn().dataset.state === "clean", "saved");
    await until(() => toasts() === 0, "toast dismissed");
  });

  it("marks Save as disabled during a conflict (the dialog decides)", async () => {
    await openEditor();
    type("X");
    putReply = () => json(409, { error: "changed on disk", rev: "rDisk", content: "= other\n" });
    await clickSave();
    await until(() => saveBtn().dataset.state === "conflict", "conflict");
    expect(saveBtn().getAttribute("aria-disabled")).toBe("true");
    expect(host.querySelector(".save-conflict")).not.toBeNull();
    const n = puts.length;
    await clickSave();
    await tick();
    expect(puts.length).toBe(n);
  });
});
