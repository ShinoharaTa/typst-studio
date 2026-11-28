import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { ProjectSummary } from "../api/types";
import { articleContext, articleTitle } from "../lib/article-label";
import { useStudioEvent } from "../lib/hooks";
import { useLastEdit } from "../lib/last-edit";
import { formatRoute } from "../lib/route";
import { Play } from "lucide-react";
import { GitBadge } from "./GitBadge";
import { Alert } from "./ui/alert";
import { EmptyState } from "./ui/empty-state";
import { List, ListItemContent, ListItemEyebrow, ListItemLink, ListItemTitle, ListMain } from "./ui/list";

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
    <div className="screen list-screen">
      <header className="topbar">
        <h1 className="topbar-title">プロジェクト</h1>
      </header>
      <ListMain>
        {error && (
          <Alert variant="destructive" inset="none">
            {error}
          </Alert>
        )}
        {list === null && !error && <EmptyState>読み込み中…</EmptyState>}
        {list?.length === 0 && <EmptyState>プロジェクトがありません</EmptyState>}
        {list && <ContinueCard projects={list.map((p) => p.name)} />}
        <List>
          {list?.map((p) => (
            <li key={p.name}>
              <ListItemLink href={formatRoute({ view: "articles", project: p.name })}>
                <ListItemContent className="gap-2">
                  <ListItemTitle>{p.name}</ListItemTitle>
                  <GitBadge git={p} />
                  {p.error && (
                    <Alert variant="destructive" size="sm" inset="none" className="self-stretch">
                      設定エラー: {p.error}
                    </Alert>
                  )}
                </ListItemContent>
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
      className="continue-card mb-6"
      href={formatRoute({ view: "edit", project, article: last.article, file: last.file, tab: "edit" })}
      title={last.file}
    >
      {/* 地はほかの行と同じ箱の色。一覧とは 24px 離し、見出し（続きから・アイコン）で別のものと分かるようにする */}
      <ListItemContent>
        <ListItemEyebrow>
          <Play />
          続きから
        </ListItemEyebrow>
        <ListItemTitle>
          {project} / {name}
        </ListItemTitle>
      </ListItemContent>
    </ListItemLink>
  );
}
