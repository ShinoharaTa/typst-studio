import type { ProjectSummary } from "../api/types";
import { cn } from "../lib/cn";
import { Badge } from "./ui/badge";

type Git = Pick<ProjectSummary, "branch" | "detached" | "head" | "uncommitted" | "unpushed" | "upstream" | "gitError">;

// ブランチ名・未コミット・未 push（表示のみ。spec 4.1）。ブランチのピルの地は置かれた面が決める。
// compact（記事一覧・編集画面のヘッダ）は 1 行に収め、長いブランチ名は省略する（全文は title）。
// ヘッダの高さを一定に保つため（トーストの位置 --toast-top がこの高さを前提にしている。styles/screen.css）
export function GitBadge({ git, compact = false }: { git: Git; compact?: boolean }) {
  if (git.gitError && git.branch === null) return <Badge variant="destructive">Git: 読めません</Badge>;
  const branch = git.detached ? `(detached ${git.head?.slice(0, 7) ?? ""})` : (git.branch ?? "—");
  const unpushed = git.upstream === null ? (compact ? null : "upstream 無し") : `未 push ${git.unpushed ?? "?"}`;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", compact ? "flex-nowrap" : "flex-wrap")}>
      {compact ? (
        <Badge variant="neutral" className="min-w-0 font-mono" title={`ブランチ: ${branch}`}>
          <span className="truncate">{branch}</span>
        </Badge>
      ) : (
        <Badge variant="neutral" className="font-mono wrap-anywhere whitespace-normal" title="ブランチ">
          {branch}
        </Badge>
      )}
      <Badge variant={git.uncommitted ? "warning" : "plain"} className="flex-none">
        {compact ? `変更 ${git.uncommitted ?? "?"}` : `未コミット ${git.uncommitted ?? "?"}`}
      </Badge>
      {unpushed && (
        <Badge variant={git.unpushed ? "warning" : "plain"} className="flex-none">
          {unpushed}
        </Badge>
      )}
    </span>
  );
}
