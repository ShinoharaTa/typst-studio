import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useStudioEvent } from "../lib/hooks";
import { formatRoute } from "../lib/route";
import { useProjectGit } from "./useProjectGit";
import { GitBadge } from "./GitBadge";

export function ArticleList({ project }: { project: string }) {
  const [list, setList] = useState<{ path: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const git = useProjectGit(project);

  const reload = useCallback(() => {
    api.articles(project).then(
      (l) => {
        setList(l);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [project]);

  useEffect(reload, [reload]);

  useStudioEvent((e) => {
    if ((e.type === "articles-changed" || e.type === "config-changed") && e.project === project) reload();
  }, reload);

  return (
    <div className="screen">
      <header className="topbar">
        <a className="icon-btn" href={formatRoute({ view: "projects" })} aria-label="プロジェクト一覧へ">
          ‹
        </a>
        <div className="topbar-text">
          <h1 className="topbar-title">{project}</h1>
          {git && <GitBadge git={git} compact />}
        </div>
      </header>
      <main className="list-main">
        {error && <p className="notice error">{error}</p>}
        {list === null && !error && <p className="muted pad">読み込み中…</p>}
        {list?.length === 0 && <p className="muted pad">記事がありません（articles.glob に一致するファイルが無い）</p>}
        <ul className="list">
          {list?.map((a) => {
            const slash = a.path.lastIndexOf("/");
            return (
              <li key={a.path}>
                <a
                  className="list-row"
                  href={formatRoute({ view: "edit", project, article: a.path, file: a.path, tab: "edit" })}
                >
                  <span className="list-row-title">{a.path.slice(slash + 1)}</span>
                  {slash > 0 && <span className="list-row-sub">{a.path.slice(0, slash)}</span>}
                </a>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
