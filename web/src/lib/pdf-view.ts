import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  capturePosition,
  layoutPages,
  PAGE_GAP,
  pageAt,
  pagesToPrerender,
  restoreScrollTop,
  totalHeight,
  type PageLayout,
  type PdfPosition,
} from "./pdfpos";

// worker は web/dist/assets から配信する
GlobalWorkerOptions.workerSrc = workerUrl;

// iOS Safari のキャンバスの上限（約 16.7M ピクセル）より小さく抑える
const MAX_CANVAS_PIXELS = 12_000_000;
// 表示中のページからこれより離れたページのキャンバスは捨てる
const KEEP_RADIUS = 3;

interface Slot {
  el: HTMLDivElement;
  canvas?: HTMLCanvasElement;
  task?: RenderTask;
  // 描いたときの CSS 幅
  renderedWidth?: number;
}

interface Loaded {
  // 破棄は読み込みタスクから行う
  task: PDFDocumentLoadingTask;
  doc: PDFDocumentProxy;
  // 1 ページ目の大きさ（scale 1）。本は全ページ同じ大きさとみなす
  base: { w: number; h: number };
  inner: HTMLDivElement;
  slots: Slot[];
  layout: PageLayout;
  width: number;
}

export interface PdfViewEvents {
  onPage(page: number, total: number): void;
  onError(message: string): void;
}

export class PdfView {
  private cur?: Loaded;
  private zoom = 1;
  private loadSeq = 0;
  private raf = 0;
  private ro: ResizeObserver;
  private lastWidth = 0;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly ev: PdfViewEvents,
  ) {
    scroller.addEventListener("scroll", this.onScroll, { passive: true });
    this.ro = new ResizeObserver(() => {
      const w = this.scroller.clientWidth;
      if (w > 0 && w !== this.lastWidth) {
        this.lastWidth = w;
        this.relayout();
      }
    });
    this.ro.observe(scroller);
  }

  get position(): PdfPosition | undefined {
    return this.cur ? capturePosition(this.cur.layout, this.scroller.scrollTop, this.zoom) : undefined;
  }

  // 新しい PDF に差し替える。描き終えるまで前の PDF を出したままにする
  async load(url: string): Promise<void> {
    const seq = ++this.loadSeq;
    const pos = this.position ?? { page: 1, ratio: 0, zoom: this.zoom };
    // Range で必要な分だけ取る（サーバーは accept-ranges: bytes）
    const task = getDocument({ url, disableAutoFetch: true, disableStream: true, withCredentials: true });
    try {
      const doc = await task.promise;
      if (seq !== this.loadSeq) return void task.destroy();
      const p1 = await doc.getPage(1);
      const vp = p1.getViewport({ scale: 1 });
      const next = this.build(task, doc, { w: vp.width, h: vp.height });
      const top = restoreScrollTop(next.layout, pos);
      const view = this.scroller.clientHeight || 600;
      await Promise.all(pagesToPrerender(next.layout, top, view).map((i) => this.renderSlot(next, i)));
      if (seq !== this.loadSeq) {
        next.slots.forEach((s) => s.task?.cancel());
        return void task.destroy();
      }
      const old = this.cur;
      this.cur = next;
      this.scroller.replaceChildren(next.inner);
      this.scroller.scrollTop = top;
      if (old) {
        old.slots.forEach((s) => s.task?.cancel());
        void old.task.destroy();
      }
      this.update();
    } catch (e) {
      if (this.cur?.task !== task) void task.destroy();
      if (seq === this.loadSeq) this.ev.onError((e as Error).message);
    }
  }

  setZoom(z: number): void {
    if (z === this.zoom) return;
    const pos = this.position;
    this.zoom = z;
    this.relayout(pos);
  }

  destroy(): void {
    this.loadSeq++;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.scroller.removeEventListener("scroll", this.onScroll);
    if (this.cur) {
      this.cur.slots.forEach((s) => s.task?.cancel());
      void this.cur.task.destroy();
      this.cur = undefined;
    }
  }

  private pageWidth(): number {
    const fit = Math.max(100, (this.scroller.clientWidth || 360) - PAGE_GAP * 2);
    // 幅に合わせた大きさを 100% とする
    return Math.round(fit * this.zoom);
  }

  private build(task: PDFDocumentLoadingTask, doc: PDFDocumentProxy, base: { w: number; h: number }): Loaded {
    const inner = document.createElement("div");
    inner.className = "pdf-inner";
    const slots: Slot[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const el = document.createElement("div");
      el.className = "pdf-page";
      el.dataset.page = String(i + 1);
      inner.append(el);
      slots.push({ el });
    }
    const l: Loaded = { task, doc, base, inner, slots, layout: { tops: [], heights: [] }, width: 0 };
    this.applyLayout(l);
    return l;
  }

  private applyLayout(l: Loaded): void {
    const w = this.pageWidth();
    const h = Math.round((w * l.base.h) / l.base.w);
    l.width = w;
    l.layout = layoutPages(l.slots.map(() => h));
    l.inner.style.height = `${totalHeight(l.layout)}px`;
    l.inner.style.width = `${w + PAGE_GAP * 2}px`;
    l.slots.forEach((s, i) => {
      s.el.style.top = `${l.layout.tops[i]}px`;
      s.el.style.width = `${w}px`;
      s.el.style.height = `${h}px`;
    });
  }

  private relayout(pos = this.position): void {
    const l = this.cur;
    if (!l) return;
    this.applyLayout(l);
    if (pos) this.scroller.scrollTop = restoreScrollTop(l.layout, pos);
    this.update();
  }

  private onScroll = (): void => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.update());
  };

  // 見えているページを描き、遠いページを捨てる
  private update(): void {
    const l = this.cur;
    if (!l) return;
    const top = this.scroller.scrollTop;
    const view = this.scroller.clientHeight || 600;
    const first = pageAt(l.layout, top);
    const last = pageAt(l.layout, top + view - 1);
    for (let i = Math.max(0, first - 1); i <= Math.min(l.slots.length - 1, last + 1); i++) void this.renderSlot(l, i);
    l.slots.forEach((s, i) => {
      if (s.canvas && (i < first - KEEP_RADIUS || i > last + KEEP_RADIUS)) {
        s.task?.cancel();
        s.task = undefined;
        s.canvas.width = 0;
        s.canvas.height = 0;
        s.canvas.remove();
        s.canvas = undefined;
        s.renderedWidth = undefined;
      }
    });
    this.ev.onPage(capturePosition(l.layout, top, this.zoom).page, l.slots.length);
  }

  private async renderSlot(l: Loaded, i: number): Promise<void> {
    const s = l.slots[i];
    if (!s || s.renderedWidth === l.width) return;
    s.task?.cancel();
    const width = l.width;
    s.renderedWidth = width;
    try {
      const page = await l.doc.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const cssScale = width / vp1.width;
      let dpr = window.devicePixelRatio || 1;
      const px = vp1.width * vp1.height * (cssScale * dpr) ** 2;
      if (px > MAX_CANVAS_PIXELS) dpr *= Math.sqrt(MAX_CANVAS_PIXELS / px);
      const vp = page.getViewport({ scale: cssScale * dpr });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const task = page.render({ canvas, viewport: vp });
      s.task = task;
      await task.promise;
      if (s.task !== task) return;
      s.task = undefined;
      // 描き終えてから入れ替える（白く抜けない）
      s.canvas?.remove();
      s.canvas = canvas;
      s.el.append(canvas);
    } catch {
      // 取り消し・失敗。次の update で描き直す
      if (s.renderedWidth === width) s.renderedWidth = undefined;
    }
  }
}
