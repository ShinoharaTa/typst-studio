import { useEffect, useRef, useState } from "react";
import { ArticleList } from "./components/ArticleList";
import { EditorScreen } from "./components/EditorScreen";
import { ProjectList } from "./components/ProjectList";
import { Toaster } from "./components/ui/sonner";
import { useKeyboardInset } from "./lib/hooks";
import { getLeaveGuard, leavesFile, parseRoute } from "./lib/route";

// ハッシュの変化を受け、編集画面を離れるときは保存できたことを確かめてから切り替える。
// 保存できなければ（衝突・失敗）編集画面に留まり、履歴も元の並びに戻す。
// 戻る・進むを見分けるため、確定した履歴エントリの state に通し番号（tsIdx）を入れておく
const idxOf = (): number | null => {
  const st = window.history.state as { tsIdx?: unknown } | null;
  return st && typeof st.tsIdx === "number" ? st.tsIdx : null;
};
const stamp = (idx: number) => window.history.replaceState({ ...(window.history.state ?? {}), tsIdx: idx }, "");

export function useGuardedRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const routeRef = useRef(route);
  routeRef.current = route;
  const committed = useRef(window.location.hash);
  const curIdx = useRef(0);
  const seq = useRef(0);
  useEffect(() => {
    const first = idxOf();
    if (first === null) stamp(0);
    curIdx.current = first ?? 0;
    const onHash = async () => {
      // 保存を待っている間に元の URL へ戻った場合も、待っていた結果を捨てる
      const my = ++seq.current;
      const hash = window.location.hash;
      if (hash === committed.current) return;
      const next = parseRoute(hash);
      // null は新しく積まれたエントリ（リンク・ハッシュの代入）
      const idx = idxOf();
      const guard = getLeaveGuard();
      if (guard && leavesFile(routeRef.current, next)) {
        const ok = await guard().catch(() => false);
        if (my !== seq.current) return;
        if (!ok) {
          if (idx !== null && idx < curIdx.current) {
            // 戻るで止めた: 今いる戻り先のエントリはそのままにして、編集画面を積み直す（[一覧, 編集] を保つ）
            const url = committed.current || window.location.pathname + window.location.search;
            window.history.pushState({ tsIdx: idx + 1 }, "", url);
            curIdx.current = idx + 1;
          } else {
            // リンク・進むで止めた: 編集画面のエントリへ戻る（届く hashchange は確定済みの URL なので無視される）
            window.history.back();
          }
          return;
        }
      }
      committed.current = hash;
      if (idx === null) {
        curIdx.current += 1;
        stamp(curIdx.current);
      } else curIdx.current = idx;
      setRoute(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export function App() {
  const route = useGuardedRoute();
  useKeyboardInset();
  return (
    <>
      {route.view === "projects" && <ProjectList />}
      {route.view === "articles" && <ArticleList key={route.project} project={route.project} />}
      {route.view === "edit" && <EditorScreen key={`${route.project}\n${route.article}`} route={route} />}
      <Toaster position="top-center" closeButton />
    </>
  );
}
