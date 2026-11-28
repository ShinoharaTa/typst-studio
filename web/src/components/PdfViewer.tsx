import { useEffect, useRef, useState } from "react";
import type { PdfView } from "../lib/pdf-view";
import { stepZoom } from "../lib/pdfpos";

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
    <div className="pdf-viewer">
      <div className="pdf-scroller" ref={scroller} />
      {!url && <p className="pdf-empty muted">まだビルドされていません</p>}
      {error && <p className="notice error pdf-error">PDF を表示できません: {error}</p>}
      <div className="pdf-bar">
        <span className="pdf-pagenum" aria-live="polite">
          {page.total ? `${page.page} / ${page.total}` : "—"}
          {loading && " ・ 読み込み中"}
        </span>
        {downloadUrl && (
          <a className="btn pdf-download" href={downloadUrl} download>
            ダウンロード
          </a>
        )}
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
