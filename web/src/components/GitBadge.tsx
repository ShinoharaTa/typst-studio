import type { ProjectSummary } from "../api/types";
import { cn } from "../lib/cn";
import { Badge } from "./ui/badge";

type Git = Pick<ProjectSummary, "branch" | "detached" | "head" | "uncommitted" | "unpushed" | "upstream" | "gitError">;

// ブランチ名・未コミット・未 push（表示のみ。spec 4.1）
//   surface: 背景の上（ヘッダ）に置くとき。ブランチのピルを 1 段上の card にする
export function GitBadge({ git, compact = false, surface = false }: { git: Git; compact?: boolean; surface?: boolean }) {
  if (git.gitError && git.branch === null) return <span className="text-xs text-destructive">Git: 読めません</span>;
  const branch = git.detached ? `(detached ${git.head?.slice(0, 7) ?? ""})` : (git.branch ?? "—");
  const unpushed = git.upstream === null ? (compact ? null : "upstream 無し") : `未 push ${git.unpushed ?? "?"}`;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <Badge variant={surface ? "surface" : "secondary"} className={cn("font-mono wrap-anywhere whitespace-normal")} title="ブランチ">
        {branch}
      </Badge>
      <Badge variant={git.uncommitted ? "warning" : "plain"}>
        {compact ? `変更 ${git.uncommitted ?? "?"}` : `未コミット ${git.uncommitted ?? "?"}`}
      </Badge>
      {unpushed && <Badge variant={git.unpushed ? "warning" : "plain"}>{unpushed}</Badge>}
    </span>
  );
}
