import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../api/client";
import type { ImageCall, Position, PreviewStatus } from "../api/types";
import { DocSession, type DocSnapshot } from "../lib/doc-session";
import { useMedia, usePageVisible, useStudioEvent } from "../lib/hooks";
import { formatRoute, navigate, type Route, type Tab } from "../lib/route";
import { Debouncer } from "../lib/schedule";
import { BookPane } from "./BookPane";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { ConflictDialog } from "./ConflictDialog";
import { EditToolbar } from "./EditToolbar";
import { GitBadge } from "./GitBadge";
import type { ImageTarget } from "./ImageEditor";
import { ImageSheet } from "./ImageSheet";
import { ImagesPane } from "./ImagesPane";
import { PreviewPane } from "./PreviewPane";
import { useProjectGit } from "./useProjectGit";

type EditRoute = Extract<Route, { view: "edit" }>;
type SideTab = Exclude<Tab, "edit">;

const MEMORY_MS = 300;
const SCROLL_MS = 200;

const TAB_LABEL: Record<Tab, string> = { edit: "編集", preview: "プレビュー", book: "本", images: "画像" };
const SAVE_LABEL: Record<DocSnapshot["state"], string> = {
  clean: "保存済み",
  dirty: "未保存",
  saving: "保存中…",
  conflict: "衝突",
  error: "保存できません",
};

interface Jump {
  path: string;
  start: Position;
}

export function EditorScreen({ route }: { route: EditRoute }) {
  const { project, article, file, tab } = route;
  // 幅 900px 以上は 2 ペイン（左: 編集、右: プレビュー / 本 / 画像）。それ未満は 1 ペイン + 下部タブ
  const wide = useMedia("(min-width: 900px)");
  const pageVisible = usePageVisible();
  const git = useProjectGit(project);
  const editor = useRef<CodeEditorHandle>(null);
  const session = useRef<DocSession | null>(null);
  const [snap, setSnap] = useState<DocSnapshot>({ state: "clean", diskChanged: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewStatus | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const [previewStarting, setPreviewStarting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [compile, setCompile] = useState<{ ok: boolean; message?: string } | null>(null);
  const [jump, setJump] = useState<Jump | null>(null);
  const [sheet, setSheet] = useState<ImageTarget | null>(null);
  const [imagesKey, setImagesKey] = useState(0);
  const [lastSide, setLastSide] = useState<SideTab>("preview");
  // 別のファイルを開いた後に移動する位置（1 始まり）
  const pendingGoto = useRef<{ line: number; column: number } | null>(null);

  const sideTab: SideTab = tab === "edit" ? lastSide : tab;
  useEffect(() => {
    if (tab !== "edit") setLastSide(tab);
  }, [tab]);
  const shown = (t: Tab) => (wide ? (t === "edit" ? true : sideTab === t) : tab === t);

  const routeRef = useRef(route);
  routeRef.current = route;
  const setTab = useCallback((t: Tab) => navigate({ ...routeRef.current, tab: t }, true), []);

  const previewIsMine = () => {
    const p = previewRef.current;
    return p?.state === "running" && p.project === project;
  };

  // 入力 300ms 後に未保存の内容をプレビューへ
  const memory = useMemo(
    () =>
      new Debouncer(MEMORY_MS, () => {
        const s = session.current;
        if (!s?.loaded || !previewIsMine()) return;
        api.previewMemory(project, file, editor.current?.getDoc() ?? "").catch(() => undefined);
      }),
    [project, file],
  );
  const cursor = useRef<{ line: number; character: number } | null>(null);
  const scroll = useMemo(
    () =>
      new Debouncer(SCROLL_MS, () => {
        const c = cursor.current;
        if (!c || !previewIsMine()) return;
        api.previewScroll(project, file, c.line, c.character).catch(() => undefined);
      }),
    [project, file],
  );
  useEffect(
    () => () => {
      memory.cancel();
      scroll.cancel();
    },
    [memory, scroll],
  );

  // ファイルを開く
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const s = new DocSession(
      {
        read: () => api.readFile(project, file),
        write: (content, baseRev) => api.writeFile(project, file, content, baseRev),
      },
      () => editor.current?.getDoc() ?? "",
      setSnap,
      (content) => editor.current?.setDoc(content),
    );
    session.current = s;
    // 前のファイルの内容を残さない（前のセッションは閉じた時点の内容で保存済み）
    editor.current?.setDoc("", { resetHistory: true });
    let cancelled = false;
    s.load().then(
      (content) => {
        if (cancelled) return;
        editor.current?.setDoc(content, { resetHistory: true });
        setLoading(false);
        const g = pendingGoto.current;
        pendingGoto.current = null;
        if (g) requestAnimationFrame(() => editor.current?.goto(g.line, g.column));
      },
      (e: Error) => {
        if (cancelled) return;
        setLoading(false);
        setLoadError(e.message);
      },
    );
    return () => {
      cancelled = true;
      void s.flush();
      s.dispose();
      if (session.current === s) session.current = null;
    };
  }, [project, file]);

  // 記事のプレビューを始める
  const startPreview = useCallback(() => {
    setPreviewStarting(true);
    setPreviewError(null);
    api.previewStart(project, article).then(
      (st) => {
        setPreview(st);
        setPreviewStarting(false);
      },
      (e: Error) => {
        setPreviewStarting(false);
        setPreviewError(e.message);
      },
    );
  }, [project, article]);
  // 既にこの記事で動いていれば起動し直さない（start は動いているものを止めてから起動する）
  useEffect(() => {
    let cancelled = false;
    api.previewStatus().then(
      (st) => {
        if (cancelled) return;
        if (st.state === "running" && st.project === project && st.article === article) setPreview(st);
        else startPreview();
      },
      () => !cancelled && startPreview(),
    );
    return () => {
      cancelled = true;
    };
  }, [project, article, startPreview]);

  useEffect(() => {
    if (snap.state === "error" && snap.error) toast.error(`保存できません: ${snap.error}`);
  }, [snap.state, snap.error]);

  // 裏に回る・閉じるときは待たずに保存する
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void session.current?.flush();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (session.current?.dirty) e.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  // ソースの位置へ（1 始まり）。別のファイルなら保存してから開く
  const gotoSource = useCallback(
    async (path: string, line: number, column = 1) => {
      const r = routeRef.current;
      if (!wide) setTab("edit");
      if (path === r.file) {
        requestAnimationFrame(() => editor.current?.goto(line, column));
        return;
      }
      await session.current?.flush();
      pendingGoto.current = { line, column };
      navigate({ ...r, file: path, tab: wide ? r.tab : "edit" });
    },
    [wide, setTab],
  );

  const openSheet = useCallback(
    async (t: ImageTarget) => {
      // 同じファイルに未保存の編集があれば先に保存する（画像の書き換えはディスクの内容に対して行う）
      if (t.call.path === routeRef.current.file) await session.current?.flush();
      setSheet(t);
    },
    [],
  );

  useStudioEvent(
    (e) => {
      switch (e.type) {
        case "file-changed":
          if (e.project === project && e.path === file) void session.current?.external(e.rev);
          break;
        case "preview-status": {
          const { type: _t, ...st } = e;
          setPreview(st);
          break;
        }
        case "preview-compile":
          if (e.project === project) setCompile({ ok: e.ok, message: e.message });
          break;
        case "preview-jump":
          if (e.project !== project) break;
          // タブは勝手に切り替えない（スクロール中の誤タップ対策）。チップかシートを出す
          if (e.image) void openSheet({ call: e.image });
          else setJump({ path: e.path, start: e.start });
          break;
      }
    },
    () => {
      api.previewStatus().then(setPreview, () => undefined);
      const s = session.current;
      if (s?.rev) api.readFile(project, file).then((f) => void s.external(f.rev), () => undefined);
    },
  );

  const save = () => void session.current?.save();
  const conflict = snap.state === "conflict";
  const fileName = file.slice(file.lastIndexOf("/") + 1);

  const editPane = (
    <section className="pane pane-edit" data-active={shown("edit")} aria-label="編集">
      {loadError && <p className="notice error">{loadError}</p>}
      {snap.diskChanged && !conflict && <p className="notice small">ディスク側で変更あり（保存時に確認します）</p>}
      <div className="editor-wrap" data-loading={loading}>
        <CodeEditor
          ref={editor}
          onDocChange={() => {
            session.current?.edited();
            memory.schedule();
          }}
          onCursor={(line, character) => {
            cursor.current = { line, character };
            scroll.schedule();
          }}
          onSave={save}
        />
      </div>
      <EditToolbar
        onSave={save}
        onUndo={() => editor.current?.undo()}
        onInsert={(ch) => editor.current?.insert(ch)}
        saveDisabled={snap.state === "clean" || snap.state === "saving"}
      />
    </section>
  );

  const sidePanes = (
    <>
      <section className="pane pane-preview" data-active={shown("preview")} aria-label="プレビュー">
        <PreviewPane
          project={project}
          article={article}
          status={preview}
          starting={previewStarting}
          error={previewError}
          compile={compile}
          onStart={startPreview}
        />
      </section>
      <section className="pane pane-book" data-active={shown("book")} aria-label="本">
        <BookPane project={project} active={shown("book") && pageVisible} onGoto={(f, l, c) => void gotoSource(f, l, c)} />
      </section>
      <section className="pane pane-images" data-active={shown("images")} aria-label="画像">
        <ImagesPane
          project={project}
          article={article}
          file={file}
          refreshKey={imagesKey}
          onOpen={(t) => void openSheet(t)}
          onGoto={(c: ImageCall) => void gotoSource(c.path, c.line, c.column)}
          onInsert={(text) => {
            setTab("edit");
            requestAnimationFrame(() => {
              editor.current?.focus();
              editor.current?.insert(text);
            });
          }}
        />
      </section>
    </>
  );

  return (
    <div className="screen editor-screen" data-wide={wide}>
      <header className="topbar">
        <a className="icon-btn" href={formatRoute({ view: "articles", project })} aria-label="記事一覧へ">
          ‹
        </a>
        <div className="topbar-text">
          <h1 className="topbar-title" title={file}>
            {fileName}
            {file !== article && <span className="muted small"> （記事: {article.slice(article.lastIndexOf("/") + 1)}）</span>}
          </h1>
          <div className="topbar-sub">
            {git && <GitBadge git={git} compact />}
            <span className={`save-state save-${snap.state}`}>{SAVE_LABEL[snap.state]}</span>
          </div>
        </div>
      </header>

      <div className="panes">
        {editPane}
        <div className="side">
          {wide && (
            <nav className="side-tabs" aria-label="表示の切り替え">
              {(["preview", "book", "images"] as const).map((t) => (
                <button key={t} type="button" className="tab" aria-pressed={sideTab === t} onClick={() => setTab(t)}>
                  {TAB_LABEL[t]}
                </button>
              ))}
            </nav>
          )}
          <div className="side-body">{sidePanes}</div>
        </div>
        {jump && (
          <div className="chip-wrap">
            <button
              type="button"
              className="chip"
              onClick={() => {
                const j = jump;
                setJump(null);
                void gotoSource(j.path, j.start.line + 1, j.start.character + 1);
              }}
            >
              ソースへ（{jumpLabel(jump)}）
            </button>
            <button type="button" className="chip chip-close" onClick={() => setJump(null)} aria-label="閉じる">
              ×
            </button>
          </div>
        )}
      </div>

      {!wide && (
        <nav className="bottom-tabs" aria-label="表示の切り替え">
          {(["edit", "preview", "book", "images"] as const).map((t) => (
            <button key={t} type="button" className="tab" aria-pressed={tab === t} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>
      )}

      <ImageSheet
        project={project}
        target={sheet}
        onClose={(applied) => {
          setSheet(null);
          setImagesKey((k) => k + 1);
          if (applied && applied.call.path === routeRef.current.file) void session.current?.external(applied.rev);
        }}
        onGoto={(c) => {
          setSheet(null);
          void gotoSource(c.path, c.line, c.column);
        }}
      />

      <ConflictDialog
        open={conflict}
        path={file}
        onReload={() => {
          const s = session.current;
          if (!s) return;
          editor.current?.setDoc(s.resolveReload());
          api.previewMemoryReset(project, file).catch(() => undefined);
        }}
        onOverwrite={() => void session.current?.resolveOverwrite()}
      />
    </div>
  );
}

function jumpLabel(jump: Jump): string {
  return `${jump.path.slice(jump.path.lastIndexOf("/") + 1)}:${jump.start.line + 1}`;
}
