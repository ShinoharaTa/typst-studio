import { useEffect, useRef, useState } from "react";
import type { PdfView } from "../lib/pdf-view";
import { stepZoom } from "../lib/pdfpos";

// pdf.js で本全体の PDF を出す。url が変わったら、位置と拡大率を保ったまま裏で差し替える
export function PdfViewer({ url }: { url: string | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const view = useRef<PdfView | null>(null);
  const [page, setPage] = useState({ page: 0, total: 0 });
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // pdf.js は大きいので、本のペインが出来てから読み込む
  const [ready, setReady] = useState(false);
  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!url || !ready || !view.current) return;
    setError(null);
    setLoading(true);
    void view.current.load(url).finally(() => setLoading(false));
  }, [url, ready]);

  const changeZoom = (z: number) => {
    setZoom(z);
    view.current?.setZoom(z);
  };

  return (
    <div className="pdf-viewer">
      <div className="pdf-scroller" ref={scroller} />
      {!url && <p className="pdf-empty muted">まだビルドされていません</p>}
      {error && <p className="notice error pdf-error">PDF を表示できません: {error}</p>}
      <div className="pdf-bar">
        <span className="pdf-pagenum" aria-live="polite">
          {page.total ? `${page.page} / ${page.total}` : "—"}
          {loading && " ・ 読み込み中"}
        </span>
        <button type="button" className="icon-btn" onClick={() => changeZoom(stepZoom(zoom, -1))} aria-label="縮小">
          −
        </button>
        <button type="button" className="btn-text" onClick={() => changeZoom(1)} aria-label="幅に合わせる">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="icon-btn" onClick={() => changeZoom(stepZoom(zoom, 1))} aria-label="拡大">
          ＋
        </button>
      </div>
    </div>
  );
}
