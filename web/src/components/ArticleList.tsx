import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { groupArticles } from "../lib/article-label";
import { useStudioEvent } from "../lib/hooks";
import { useLastEdit } from "../lib/last-edit";
import { formatRoute } from "../lib/route";
import { GitBadge } from "./GitBadge";
import { useProjectGit } from "./useProjectGit";

export function ArticleList({ project }: { project: string }) {
  const [list, setList] = useState<{ path: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const git = useProjectGit(project);
  const last = useLastEdit();
  const lastArticle = last?.project === project ? last.article : null;

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

  // 記事の名前はディレクトリ名。途中の階層は見出しにまとめる（API の並びは保つ）
  const groups = useMemo(() => (list ? groupArticles(list) : []), [list]);

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
        {groups.map((g, i) => (
          <section key={`${i}:${g.group.join("/")}`} className="list-section">
            {g.heading && <h2 className="list-heading">{g.heading}</h2>}
            <ul className="list">
              {g.items.map((a) => (
                <li key={a.path}>
                  <a
                    className="list-row"
                    href={formatRoute({ view: "edit", project, article: a.path, file: a.path, tab: "edit" })}
                    title={a.path}
                    aria-label={`${a.label.name}（${a.path === lastArticle ? "前回・" : ""}${a.path}）`}
                  >
                    <span className="list-row-title">
                      {a.label.name}
                      {a.path === lastArticle && <span className="pill last-pill">前回</span>}
                    </span>
                    {a.label.file && <span className="list-row-sub">{a.label.file}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
