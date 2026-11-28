import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { ProjectSummary } from "../api/types";
import { articleContext, articleLabel } from "../lib/article-label";
import { useStudioEvent } from "../lib/hooks";
import { useLastEdit } from "../lib/last-edit";
import { formatRoute } from "../lib/route";
import { GitBadge } from "./GitBadge";

export function ProjectList() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.projects().then(
      (l) => {
        setList(l);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(reload, [reload]);

  useStudioEvent((e) => {
    if (e.type === "git-changed") {
      const { type: _t, project, ...git } = e;
      setList((l) => l?.map((p) => (p.name === project ? { ...p, ...git } : p)) ?? l);
    } else if (e.type === "config-changed") reload();
  }, reload);

  return (
    <div className="screen">
      <header className="topbar">
        <h1 className="topbar-title">プロジェクト</h1>
      </header>
      <main className="list-main project-list">
        {error && <p className="notice error">{error}</p>}
        {list === null && !error && <p className="muted pad">読み込み中…</p>}
        {list?.length === 0 && <p className="muted pad">プロジェクトがありません</p>}
        {list && <ContinueCard projects={list.map((p) => p.name)} />}
        <ul className="list">
          {list?.map((p) => (
            <li key={p.name}>
              <a className="list-row" href={formatRoute({ view: "articles", project: p.name })}>
                <span className="list-row-title">{p.name}</span>
                <GitBadge git={p} />
                {p.error && <span className="list-row-error">設定エラー: {p.error}</span>}
              </a>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

// 「続きから」: 最後に開いた編集先へ 1 回で戻る。プロジェクトか記事が無くなっていれば出さない
function ContinueCard({ projects }: { projects: string[] }) {
  const last = useLastEdit();
  const [articles, setArticles] = useState<{ path: string }[] | null>(null);
  const project = last && projects.includes(last.project) ? last.project : null;
  useEffect(() => {
    setArticles(null);
    if (!project) return;
    let cancelled = false;
    api.articles(project).then(
      (l) => !cancelled && setArticles(l),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [project]);
  if (!last || !project || !articles?.some((a) => a.path === last.article)) return null;
  const name = articleLabel(last.article, articleContext(articles.map((a) => a.path))).name;
  return (
    <a
      className="list-row continue-card"
      href={formatRoute({ view: "edit", project, article: last.article, file: last.file, tab: "edit" })}
      title={last.file}
    >
      <span className="continue-label">続きから</span>
      <span className="list-row-title">
        {project} / {name}
      </span>
    </a>
  );
}
