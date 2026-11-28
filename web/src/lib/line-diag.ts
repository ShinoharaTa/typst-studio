// カーソルのある行の診断（スマホはホバーが無いので、lint の吹き出しの代わりに帯で出す）

export interface CursorDiag {
  severity: "error" | "warning";
  message: string;
}

// エラー → 警告の順に（同じ重さの中は元の順）
export function sortDiags<T extends CursorDiag>(diags: T[]): T[] {
  return [...diags].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

// 帯に出す 1 行の文（件数が複数なら先頭に件数）
export function diagSummary(ds: CursorDiag[]): string {
  if (ds.length === 0) return "";
  const head = ds[0].severity === "error" ? "エラー" : "警告";
  return `${head}${ds.length > 1 ? `（${ds.length} 件）` : ""}: ${ds.map((d) => d.message).join(" / ")}`;
}
