// ハッシュルーティング
//   #/                                   プロジェクト一覧
//   #/p/<name>                           記事一覧
//   #/p/<name>/edit/<article>?file=&tab= 編集（file は開いているファイル。記事と同じなら省く）

export type Tab = "edit" | "preview" | "book" | "images";
export const TABS: Tab[] = ["edit", "preview", "book", "images"];

export type Route =
  | { view: "projects" }
  | { view: "articles"; project: string }
  | { view: "edit"; project: string; article: string; file: string; tab: Tab };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, "");
  const [pathPart, query = ""] = h.split("?", 2);
  const seg = pathPart.split("/").filter(Boolean);
  let dec: string[];
  try {
    dec = seg.map(decodeURIComponent);
  } catch {
    return { view: "projects" };
  }
  if (dec[0] !== "p" || !dec[1]) return { view: "projects" };
  const project = dec[1];
  if (dec[2] === "edit" && dec.length > 3) {
    // 記事パスは 1 セグメントにエンコードするが、/ のまま来ても受ける
    const article = dec.slice(3).join("/");
    const q = new URLSearchParams(query);
    const tab = q.get("tab") as Tab | null;
    return {
      view: "edit",
      project,
      article,
      file: q.get("file") || article,
      tab: tab && TABS.includes(tab) ? tab : "edit",
    };
  }
  return { view: "articles", project };
}

export function formatRoute(r: Route): string {
  const e = encodeURIComponent;
  switch (r.view) {
    case "projects":
      return "#/";
    case "articles":
      return `#/p/${e(r.project)}`;
    case "edit": {
      const q = new URLSearchParams();
      if (r.file !== r.article) q.set("file", r.file);
      if (r.tab !== "edit") q.set("tab", r.tab);
      const qs = q.toString();
      return `#/p/${e(r.project)}/edit/${e(r.article)}${qs ? `?${qs}` : ""}`;
    }
  }
}

// replace: 履歴を積まない（タブの切り替えなど）
export function navigate(r: Route, replace = false): void {
  const hash = formatRoute(r);
  if (window.location.hash === hash) return;
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}
