// PDF 表示の位置（spec 3.3.4: ページ番号 + ページ内の縦位置の割合 + 拡大率）

export interface PdfPosition {
  // 1 始まり
  page: number;
  // ページ内の縦位置（0〜1）。表示領域の上端がページのどこにあるか
  ratio: number;
  zoom: number;
}

// ページを縦に並べた配置。tops[i] は i 番目（0 始まり）のページの上端
export interface PageLayout {
  tops: number[];
  heights: number[];
}

export const PAGE_GAP = 12;

// 各ページの高さから配置を作る
export function layoutPages(heights: number[], gap = PAGE_GAP): PageLayout {
  const tops: number[] = [];
  let y = gap;
  for (const h of heights) {
    tops.push(y);
    y += h + gap;
  }
  return { tops, heights };
}

export function totalHeight(l: PageLayout, gap = PAGE_GAP): number {
  const n = l.tops.length;
  return n === 0 ? 0 : l.tops[n - 1] + l.heights[n - 1] + gap;
}

// 縦位置 y を含むページ（0 始まり）。ページ間の余白はその次のページに含める
export function pageAt(l: PageLayout, y: number): number {
  const n = l.tops.length;
  if (n === 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (l.tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  // 最初のページより上の余白
  if (y < l.tops[lo] + l.heights[lo] || lo === n - 1) return lo;
  return Math.min(lo + 1, n - 1);
}

export function capturePosition(l: PageLayout, scrollTop: number, zoom: number): PdfPosition {
  if (l.tops.length === 0) return { page: 1, ratio: 0, zoom };
  const i = pageAt(l, scrollTop);
  const h = l.heights[i] || 1;
  const ratio = Math.min(1, Math.max(0, (scrollTop - l.tops[i]) / h));
  return { page: i + 1, ratio, zoom };
}

// 新しい配置での scrollTop。ページが減って無くなったら最終ページの先頭
export function restoreScrollTop(l: PageLayout, pos: PdfPosition): number {
  const n = l.tops.length;
  if (n === 0) return 0;
  if (pos.page > n) return l.tops[n - 1];
  const i = Math.max(0, pos.page - 1);
  return l.tops[i] + pos.ratio * l.heights[i];
}

// 差し替えのとき、裏で先に描いておくページ（0 始まり）
export function pagesToPrerender(l: PageLayout, scrollTop: number, viewHeight: number): number[] {
  const n = l.tops.length;
  if (n === 0) return [];
  const first = pageAt(l, scrollTop);
  const last = pageAt(l, scrollTop + Math.max(0, viewHeight - 1));
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(i);
  return out;
}

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function stepZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? ZOOM_STEPS[0];
}
