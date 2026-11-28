import { useEffect, useRef, useState } from "react";
import type { PdfView } from "../lib/pdf-view";
import { stepZoom } from "../lib/pdfpos";
import { AlertText } from "./ui/alert";
import { Button, buttonVariants } from "./ui/button";
import { Panel } from "./ui/panel";
import { cn } from "../lib/cn";

// PDF の台の上に重ねる文言
const overlay = "absolute inset-x-0 top-4 text-center";

// pdf.js で本全体の PDF を出す。url が変わったら、位置と拡大率を保ったまま裏で差し替える。
// active になるまで pdf.js も PDF も読まない。隠れている間は差し替えず、出たときに最新へ差し替える
export function PdfViewer({ url, active, downloadUrl }: { url: string | null; active: boolean; downloadUrl?: string | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const view = useRef<PdfView | null>(null);
  const [page, setPage] = useState({ page: 0, total: 0 });
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  // 一度でも表示された
  const [wanted, setWanted] = useState(active);
  const shownUrl = useRef<string | null>(null);

  useEffect(() => {
    if (active) setWanted(true);
  }, [active]);

  // pdf.js は大きいので、初めて表示されたときに読み込む
  useEffect(() => {
    if (!wanted) return;
    let v: PdfView | undefined;
    let cancelled = false;
    import("../lib/pdf-view").then(
      ({ PdfView }) => {
        if (cancelled) return;
        v = new PdfView(scroller.current!, {
          onPage: (p, total) => setPage((cur) => (cur.page === p && cur.total === total ? cur : { page: p, total })),
          onError: setError,
        });
        view.current = v;
        setReady(true);
      },
      (e: Error) => setError(e.message),
    );
    return () => {
      cancelled = true;
      v?.destroy();
      view.current = null;
    };
  }, [wanted]);

  useEffect(() => {
    if (!url || !ready || !active || !view.current || shownUrl.current === url) return;
    shownUrl.current = url;
    setError(null);
    setLoading(true);
    void view.current.load(url).finally(() => setLoading(false));
  }, [url, ready, active]);

  const changeZoom = (z: number) => {
    setZoom(z);
    view.current?.setZoom(z);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 操作部はペインの上端にまとめる（本タブの上の段: プロファイル・ビルド、状態、診断に続けて置く。PDF の台より上）。
          下端に置くのは、キーボードの上に出る編集のツールバーだけ */}
      <div className="pdf-bar flex flex-none items-center justify-end gap-1 bg-card pr-2 pb-2 pl-3">
        <span className="mr-auto text-sm text-muted-foreground" aria-live="polite">
          {page.total ? `${page.page} / ${page.total}` : "—"}
          {loading && " ・ 読み込み中"}
        </span>
        {downloadUrl && (
          <a className={buttonVariants({ size: "sm" })} href={downloadUrl} download>
            ダウンロード
          </a>
        )}
        <Button size="icon" onClick={() => changeZoom(stepZoom(zoom, -1))} aria-label="縮小">
          −
        </Button>
        <Button size="text" onClick={() => changeZoom(1)} aria-label="幅に合わせる">
          {Math.round(zoom * 100)}%
        </Button>
        <Button size="icon" onClick={() => changeZoom(stepZoom(zoom, 1))} aria-label="拡大">
          ＋
        </Button>
      </div>
      <div className="pdf-stage relative flex min-h-0 flex-1 flex-col">
        {/* PDF の台（パネルより沈んだ面） */}
        <Panel level="pdf" className="min-h-0 flex-1 overflow-auto overscroll-contain" ref={scroller} />
        {!url && <p className={cn(overlay, "text-muted-foreground")}>まだビルドされていません</p>}
        {error && (
          <AlertText variant="destructive" className={overlay}>
            PDF を表示できません: {error}
          </AlertText>
        )}
      </div>
    </div>
  );
}
