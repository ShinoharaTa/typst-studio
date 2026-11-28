import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { ProjectSummary } from "../api/types";
import { articleContext, articleTitle } from "../lib/article-label";
import { useStudioEvent } from "../lib/hooks";
import { useLastEdit } from "../lib/last-edit";
import { formatRoute } from "../lib/route";
import { GitBadge } from "./GitBadge";
import { AlertText } from "./ui/alert";
import { List, ListItemLink, ListItemTitle, ListMain } from "./ui/list";

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
        <h1 className="topbar-title px-2 text-lg font-bold">プロジェクト</h1>
      </header>
      <ListMain>
        {error && <AlertText variant="destructive">{error}</AlertText>}
        {list === null && !error && <p className="p-4 text-muted-foreground">読み込み中…</p>}
        {list?.length === 0 && <p className="p-4 text-muted-foreground">プロジェクトがありません</p>}
        {list && <ContinueCard projects={list.map((p) => p.name)} />}
        <List className="gap-2">
          {list?.map((p) => (
            <li key={p.name}>
              <ListItemLink size="lg" href={formatRoute({ view: "articles", project: p.name })}>
                <ListItemTitle>{p.name}</ListItemTitle>
                <GitBadge git={p} />
                {p.error && <span className="rounded-box bg-destructive-soft px-2.5 py-1.5 text-sm text-destructive">設定エラー: {p.error}</span>}
              </ListItemLink>
            </li>
          ))}
        </List>
      </ListMain>
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
  const name = articleTitle(last.article, articleContext(articles.map((a) => a.path)));
  return (
    <ListItemLink
      size="lg"
      className="continue-card mb-3"
      href={formatRoute({ view: "edit", project, article: last.article, file: last.file, tab: "edit" })}
      title={last.file}
    >
      {/* 地はほかの行と同じパネル色（背景との差を保つ）。強調は文字の色と矢印で出す。矢印は読み上げない */}
      <span className="text-xs font-semibold text-primary before:content-['▶_'/'']">続きから</span>
      <ListItemTitle>
        {project} / {name}
      </ListItemTitle>
    </ListItemLink>
  );
}
