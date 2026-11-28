import { useEffect, useRef, useState } from "react";
import type { PdfView } from "../lib/pdf-view";
import { stepZoom } from "../lib/pdfpos";
import { Download, Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Alert } from "./ui/alert";
import { Button, buttonVariants } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { PanelBar, Stage, StageSurface } from "./ui/panel";

// pdf.js で本全体の PDF を出す。url が変わったら、位置と拡大率を保ったまま裏で差し替える。
// active になるまで pdf.js も PDF も読まない。隠れている間は差し替えず、出たときに最新へ差し替える
// empty: まだビルドされていないときに台の中央に出す次の操作（ビルドのボタン。同じ画面の主の操作と重ねないので secondary）
// ページ番号・拡大縮小の段は、PDF があるときだけ出す
export function PdfViewer({
  url,
  active,
  downloadUrl,
  empty,
}: {
  url: string | null;
  active: boolean;
  downloadUrl?: string | null;
  empty?: ReactNode;
}) {
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
    // 段はペインの段の並びにそのまま続ける（Fragment。PanelBar は前の兄弟を見て上の余白を詰める）
    <>
      {/* 操作部はペインの上端にまとめる（本タブの上の段: プロファイル・ビルド、状態に続けて置く。PDF の台より上）。
          下端に置くのは、キーボードの上に出る編集のツールバーだけ。拡大縮小は小さい地なしのボタンにして、ビルドを主にする */}
      {url && (
        <PanelBar className="pdf-bar flex-nowrap">
          <span className="mr-auto text-caption text-muted-foreground" aria-live="polite">
            {page.total ? `${page.page} / ${page.total}` : "—"}
            {loading && " ・ 読み込み中"}
          </span>
          {downloadUrl && (
            <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={downloadUrl} download>
              <Download />
              ダウンロード
            </a>
          )}
          <Button variant="ghost" size="sm" icon onClick={() => changeZoom(stepZoom(zoom, -1))} aria-label="縮小">
            <Minus />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => changeZoom(1)} aria-label="幅に合わせる">
            {Math.round(zoom * 100)}%
          </Button>
          <Button variant="ghost" size="sm" icon onClick={() => changeZoom(stepZoom(zoom, 1))} aria-label="拡大">
            <Plus />
          </Button>
        </PanelBar>
      )}
      <Stage>
        {/* PDF の台（パネルより沈んだ面） */}
        <StageSurface ref={scroller} />
        {!url && (
          <EmptyState fill action={empty}>
            まだビルドされていません
          </EmptyState>
        )}
        {error && (
          <Alert variant="destructive" className="absolute inset-x-0 top-0">
            PDF を表示できません: {error}
          </Alert>
        )}
      </Stage>
    </>
  );
}
