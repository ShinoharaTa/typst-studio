import { useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { ArticleList } from "./components/ArticleList";
import { EditorScreen } from "./components/EditorScreen";
import { ProjectList } from "./components/ProjectList";
import { useKeyboardInset } from "./lib/hooks";
import { getLeaveGuard, leavesFile, parseRoute } from "./lib/route";

// ハッシュの変化を受け、編集画面を離れるときは保存できたことを確かめてから切り替える。
// 保存できなければ（衝突・失敗）ハッシュを戻して、編集画面に留まる
export function useGuardedRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const routeRef = useRef(route);
  routeRef.current = route;
  const committed = useRef(window.location.hash);
  const seq = useRef(0);
  useEffect(() => {
    const onHash = async () => {
      const hash = window.location.hash;
      if (hash === committed.current) return;
      const next = parseRoute(hash);
      const my = ++seq.current;
      const guard = getLeaveGuard();
      if (guard && leavesFile(routeRef.current, next)) {
        const ok = await guard().catch(() => false);
        if (my !== seq.current) return;
        if (!ok) {
          // 履歴は積まずに元の URL へ戻す（hashchange は起きない）
          const back = committed.current || window.location.pathname + window.location.search;
          window.history.replaceState(window.history.state, "", back);
          return;
        }
      }
      committed.current = hash;
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
      <Toaster position="top-center" theme="system" closeButton />
    </>
  );
}
