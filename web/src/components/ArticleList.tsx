import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { groupArticles } from "../lib/article-label";
import { useStudioEvent } from "../lib/hooks";
import { useLastEdit } from "../lib/last-edit";
import { formatRoute } from "../lib/route";
import { ChevronLeft } from "lucide-react";
import { GitBadge } from "./GitBadge";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { buttonVariants } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { List, ListHeading, ListItemContent, ListItemDescription, ListItemLink, ListItemTitle, ListMain } from "./ui/list";
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
    <div className="screen list-screen">
      <header className="topbar">
        <a className={buttonVariants({ variant: "ghost", icon: true })} href={formatRoute({ view: "projects" })} aria-label="プロジェクト一覧へ">
          <ChevronLeft />
        </a>
        <div className="topbar-text">
          <h1 className="topbar-title">{project}</h1>
          {git && <GitBadge git={git} compact />}
        </div>
      </header>
      <ListMain>
        {error && (
          <Alert variant="destructive" inset="none">
            {error}
          </Alert>
        )}
        {list === null && !error && <EmptyState>読み込み中…</EmptyState>}
        {list?.length === 0 && <EmptyState>記事がありません（articles.glob に一致するファイルが無い）</EmptyState>}
        {groups.map((g, i) => (
          <section key={`${i}:${g.group.join("/")}`} className="not-first:mt-2">
            {g.heading && <ListHeading className={i === 0 ? "mt-2" : undefined}>{g.heading}</ListHeading>}
            <List>
              {g.items.map((a) => (
                <li key={a.path}>
                  <ListItemLink
                    href={formatRoute({ view: "edit", project, article: a.path, file: a.path, tab: "edit" })}
                    title={a.path}
                    aria-label={`${a.label.name}（${a.path === lastArticle ? "前回・" : ""}${a.path}）`}
                  >
                    <ListItemContent>
                      <ListItemTitle>
                        {a.label.name}
                        {a.path === lastArticle && (
                          <Badge variant="accent" className="last-pill ml-2 align-text-bottom">
                            前回
                          </Badge>
                        )}
                      </ListItemTitle>
                      {a.label.file && <ListItemDescription>{a.label.file}</ListItemDescription>}
                    </ListItemContent>
                  </ListItemLink>
                </li>
              ))}
            </List>
          </section>
        ))}
      </ListMain>
    </div>
  );
}
