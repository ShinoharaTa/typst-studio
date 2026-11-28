import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../api/client";
import type { Diagnostic, ImageCall, Position, PreviewStatus } from "../api/types";
import { articleContext, articleLabel, type ArticleCtx } from "../lib/article-label";
import { DocSession, type DocSnapshot } from "../lib/doc-session";
import { useMedia, usePageVisible, useStudioEvent } from "../lib/hooks";
import { writeLastEdit } from "../lib/last-edit";
import { diagsAtLine, diagSummary } from "../lib/line-diag";
import { MemorySync } from "../lib/memory-sync";
import { usePref } from "../lib/prefs";
import { formatRoute, navigate, setLeaveGuard, type Route, type Tab } from "../lib/route";
import { Debouncer } from "../lib/schedule";
import { BookPane } from "./BookPane";
import { CodeEditor, type CodeEditorHandle, type LineDiagnostic } from "./CodeEditor";
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
  // 記事の名前（ディレクトリ名）を出すために一覧を 1 回読む。読めるまでは親ディレクトリ名
  const [articleCtx, setArticleCtx] = useState<ArticleCtx | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    api.articles(project).then(
      (l) => !cancelled && setArticleCtx(articleContext(l.map((a) => a.path))),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [project]);
  const articleName = articleLabel(article, articleCtx);
  // 2 ペインの左右（端末ごと）。DOM の順は変えず CSS の order で入れ替える（iframe を読み込み直さない）
  const [paneOrder, setPaneOrder] = usePref("typst-studio.paneOrder", "edit-left");
  const swapped = paneOrder === "edit-right";
  // 「続きから」のために、最後に開いた編集先を覚える
  useEffect(() => writeLastEdit({ project, article, file }), [project, article, file]);
  const editor = useRef<CodeEditorHandle>(null);
  const session = useRef<DocSession | null>(null);
  const [snap, setSnap] = useState<DocSnapshot>({ state: "clean", diskChanged: false, removed: false });
  const memory = useRef<MemorySync | null>(null);
  const [bookDiags, setBookDiags] = useState<Diagnostic[]>([]);
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
  // 画像の適用の後、ディスクの内容を読み直すまで（読み取り専用のままにする）
  const [reloadingAfterApply, setReloadingAfterApply] = useState(false);
  const locked = sheet !== null || reloadingAfterApply;
  const [imagesKey, setImagesKey] = useState(0);
  const [lastSide, setLastSide] = useState<SideTab>("preview");
  // 別のファイルを開いた後に移動する位置（1 始まり）
  const pendingGoto = useRef<{ line: number; column: number; codepoints?: boolean } | null>(null);

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
  useEffect(() => () => scroll.cancel(), [scroll]);

  // ファイルを開く
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    // 入力 300ms 後に未保存の内容をプレビューへ。保存が済んだらディスクの内容に戻す
    const mem = new MemorySync({
      set: (content) => api.previewMemory(project, file, content).catch(() => undefined),
      reset: () => api.previewMemoryReset(project, file).catch(() => undefined),
      canSend: previewIsMine,
    });
    memory.current = mem;
    const s = new DocSession(
      {
        read: () => api.readFile(project, file),
        write: (content, baseRev, opts) => api.writeFile(project, file, content, baseRev, opts),
      },
      setSnap,
      (content) => editor.current?.setDoc(content),
      { onSaved: (clean) => clean && mem.reset() },
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
        if (g) requestAnimationFrame(() => editor.current?.goto(g.line, g.column, g));
      },
      (e: Error) => {
        if (cancelled) return;
        setLoading(false);
        setLoadError(e.message);
      },
    );
    return () => {
      cancelled = true;
      // エディタは先に破棄されていることがある。内容はセッションが持っている
      const saving = s.flush();
      s.dispose();
      if (s.safe) mem.reset();
      else {
        // 保存できていない分は、プレビューに最後の内容を残す（捨てない）
        mem.flush();
        void saving.then((ok) => ok && mem.reset());
      }
      if (session.current === s) session.current = null;
      if (memory.current === mem) memory.current = null;
    };
  }, [project, file]);

  // 編集画面を離れる・別のファイルを開く前に保存する。保存できなければ移動しない（衝突のダイアログは残る）
  useEffect(
    () =>
      setLeaveGuard(async () => {
        const s = session.current;
        if (!s) return true;
        const ok = await s.flush();
        if (!ok) {
          pendingGoto.current = null;
          const st = s.snapshot;
          if (st.state === "error") toast.error(`保存できないので移動しません: ${st.error ?? ""}`);
          else if (st.state !== "conflict") toast.error("未保存の変更があるので移動しません");
        }
        return ok;
      }),
    [],
  );

  // 記事のプレビューを始める
  const applyStatus = useCallback(
    (st: PreviewStatus) => {
      setPreview(st);
      if (st.project === project && st.compile) setCompile({ ok: st.compile.ok });
    },
    [project],
  );

  const startPreview = useCallback(() => {
    setPreviewStarting(true);
    setPreviewError(null);
    api.previewStart(project, article).then(
      (st) => {
        applyStatus(st);
        setPreviewStarting(false);
      },
      (e: Error) => {
        setPreviewStarting(false);
        setPreviewError(e.message);
      },
    );
  }, [project, article, applyStatus]);
  // 既にこの記事で動いていれば起動し直さない（start は動いているものを止めてから起動する）
  useEffect(() => {
    let cancelled = false;
    api.previewStatus().then(
      (st) => {
        if (cancelled) return;
        if (st.state === "running" && st.project === project && st.article === article) applyStatus(st);
        else startPreview();
      },
      () => !cancelled && startPreview(),
    );
    return () => {
      cancelled = true;
    };
  }, [project, article, startPreview, applyStatus]);

  useEffect(() => {
    if (snap.state === "error" && snap.error) toast.error(`保存できません: ${snap.error}`);
  }, [snap.state, snap.error]);

  // 裏に回る・閉じるときは待たずに保存する
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void session.current?.flush({ keepalive: true });
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
    async (path: string, line: number, column = 1, codepoints = false) => {
      const r = routeRef.current;
      if (!wide) setTab("edit");
      if (path === r.file) {
        requestAnimationFrame(() => editor.current?.goto(line, column, { codepoints }));
        return;
      }
      // 保存は移動の確認（setLeaveGuard）で行う。保存できなければ移動しない
      pendingGoto.current = { line, column, codepoints };
      navigate({ ...r, file: path, tab: wide ? r.tab : "edit" });
    },
    [wide, setTab],
  );

  const openSheet = useCallback(
    async (t: ImageTarget) => {
      // 画像の書き換えはディスクの内容に対して行うので、未保存の編集は先に保存できていなければ開かない。
      // 開いている間はエディタを読み取り専用にする
      const ok = (await session.current?.flush()) ?? true;
      if (!ok) {
        toast.error("未保存の変更を保存できないので、画像の編集を開けません");
        return;
      }
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
        case "file-removed":
          if (e.project === project && e.path === file) session.current?.removedOnDisk();
          break;
        case "preview-status": {
          const { type: _t, ...st } = e;
          applyStatus(st);
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
      api.previewStatus().then(applyStatus, () => undefined);
      const s = session.current;
      if (s?.rev) api.readFile(project, file).then((f) => void s.external(f.rev), () => undefined);
    },
  );

  const save = () => void session.current?.save();
  // 本のビルドの診断のうち、開いているファイルのもの
  const lineDiags = useMemo<LineDiagnostic[]>(
    () =>
      bookDiags
        .filter((d) => d.file === file && d.line !== null)
        .map((d) => ({ line: d.line!, column: d.column, severity: d.severity, message: d.message })),
    [bookDiags, file],
  );
  const [cursorLine, setCursorLine] = useState(0);
  const [diagExpanded, setDiagExpanded] = useState(false);
  const cursorDiags = useMemo(() => diagsAtLine(lineDiags, cursorLine), [lineDiags, cursorLine]);
  useEffect(() => setDiagExpanded(false), [cursorLine]);
  const conflict = snap.state === "conflict";
  const fileName = file.slice(file.lastIndexOf("/") + 1);

  const editPane = (
    <section className="pane pane-edit" data-active={shown("edit")} aria-label="編集">
      {loadError && <p className="notice error">{loadError}</p>}
      {snap.diskChanged && !conflict && <p className="notice small">ディスク側で変更あり（保存時に確認します）</p>}
      {snap.removed && !conflict && <p className="notice small error">ディスク上で削除されました（保存時に作り直すか確認します）</p>}
      <div className="editor-wrap" data-loading={loading}>
        <CodeEditor
          ref={editor}
          onDocChange={(doc) => {
            const s = session.current;
            if (!s?.loaded) return;
            s.edited(doc);
            memory.current?.changed(() => doc.toString());
          }}
          readOnly={locked}
          diagnostics={lineDiags}
          onCursor={(line, character) => {
            cursor.current = { line, character };
            scroll.schedule();
            setCursorLine(line + 1);
          }}
          onSave={save}
        />
      </div>
      {cursorDiags.length > 0 && (
        // カーソルのある行の診断（タッチにはホバーが無いので、lint の吹き出しの代わりに出す）。タップで全文
        <button
          type="button"
          className={`line-diag ${cursorDiags[0].severity}`}
          data-expanded={diagExpanded}
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setDiagExpanded((x) => !x)}
        >
          {diagSummary(cursorDiags)}
        </button>
      )}
      <EditToolbar
        onSave={save}
        onUndo={() => {
          editor.current?.undo();
          // フォーカスが外れていても戻す（キーボードを閉じさせない）
          editor.current?.focus();
        }}
        onInsert={(ch) => {
          editor.current?.insert(ch);
          editor.current?.focus();
        }}
        saveDisabled={snap.state === "clean" || snap.state === "saving"}
        disabled={locked}
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
          articleCtx={articleCtx}
        />
      </section>
      <section className="pane pane-book" data-active={shown("book")} aria-label="本">
        <BookPane project={project} active={shown("book") && pageVisible} onGoto={(f, l, c) => void gotoSource(f, l, c, true)}
          onDiagnostics={setBookDiags}
        />
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
    <div className="screen editor-screen" data-wide={wide} data-swap={swapped}>
      <header className="topbar">
        <a className="icon-btn" href={formatRoute({ view: "articles", project })} aria-label="記事一覧へ">
          ‹
        </a>
        <div className="topbar-text">
          <h1 className="topbar-title" title={file}>
            {file === article ? (
              <>
                {articleName.group.length > 0 && <span className="topbar-group">{articleName.group.join(" / ")} / </span>}
                {articleName.name}
              </>
            ) : (
              fileName
            )}
          </h1>
          <div className="topbar-sub">
            {file !== article && <span className="pill article-pill">記事: {articleName.name}</span>}
            {git && <GitBadge git={git} compact />}
            <span className={`save-state save-${snap.state}`}>{SAVE_LABEL[snap.state]}</span>
          </div>
        </div>
        {wide && (
          // 両方のペインに効く操作なので、どちらのペインにも属さないヘッダに置く
          <button
            type="button"
            className="btn swap-btn"
            aria-label="編集とプレビューの左右を入れ替える"
            aria-pressed={swapped}
            onClick={() => setPaneOrder(swapped ? "edit-left" : "edit-right")}
          >
            ⇄ 入れ替え
          </button>
        )}
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
              ソースへ（{jumpLabel(jump, jump.path === article ? articleName.name : null)}）
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
        side={wide ? (swapped ? "right" : "left") : null}
        target={sheet}
        onClose={(applied) => {
          setSheet(null);
          setImagesKey((k) => k + 1);
          const s = session.current;
          if (applied && s && applied.call.path === routeRef.current.file) {
            setReloadingAfterApply(true);
            void s.external(applied.rev).finally(() => setReloadingAfterApply(false));
          }
        }}
        onGoto={(c) => {
          setSheet(null);
          void gotoSource(c.path, c.line, c.column);
        }}
      />

      <ConflictDialog
        open={conflict}
        path={file}
        conflict={snap.conflict ?? null}
        onReload={() => {
          const s = session.current;
          const content = s?.resolveReload();
          if (content == null) return;
          editor.current?.setDoc(content);
          memory.current?.reset();
        }}
        onOverwrite={() => void session.current?.resolveOverwrite()}
        onDiscard={() => session.current?.discard()}
      />
    </div>
  );
}

// 記事のファイルなら記事の名前、それ以外はファイル名
function jumpLabel(jump: Jump, article: string | null): string {
  return `${article ?? jump.path.slice(jump.path.lastIndexOf("/") + 1)}:${jump.start.line + 1}`;
}
