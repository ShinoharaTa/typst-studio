// カーソルのある行の診断（スマホはホバーが無いので、lint の吹き出しの代わりに帯で出す）

export interface LineDiag {
  // 1 始まり
  line: number;
  severity: "error" | "warning";
  message: string;
}

// その行の診断を、エラー → 警告の順に。無ければ空
export function diagsAtLine<T extends LineDiag>(diags: T[], line: number): T[] {
  return diags
    .filter((d) => d.line === line)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

// 帯に出す 1 行の文（件数が複数なら先頭に件数）
export function diagSummary(ds: LineDiag[]): string {
  if (ds.length === 0) return "";
  const head = ds[0].severity === "error" ? "エラー" : "警告";
  return `${head}${ds.length > 1 ? `（${ds.length} 件）` : ""}: ${ds.map((d) => d.message).join(" / ")}`;
}
