// 画像の width / height の値（サーバーが受け付けるのは ^\d+(\.\d+)?(%|mm|cm|pt|em|in)$ のみ）

export type Unit = "%" | "mm" | "cm" | "pt" | "em" | "in";
export interface Length {
  value: number;
  unit: Unit;
}

const LENGTH_RE = /^(\d+(?:\.\d+)?)(%|mm|cm|pt|em|in)$/;

export function parseLength(s: string | null | undefined): Length | null {
  if (!s) return null;
  const m = LENGTH_RE.exec(s.trim());
  return m ? { value: Number(m[1]), unit: m[2] as Unit } : null;
}

export function isValidLength(s: string): boolean {
  return LENGTH_RE.test(s);
}

// 数値を短く書く（小数 2 桁まで、末尾の 0 は落とす）。負や非数は 0
export function formatLength(value: number, unit: Unit): string {
  const v = Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  return `${v}${unit}`;
}

const MM_PER: Partial<Record<Unit, number>> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 };

// 絶対長を mm に直す（% と em は直せないので null）
export function toMm(l: Length): number | null {
  const f = MM_PER[l.unit];
  return f === undefined ? null : l.value * f;
}
