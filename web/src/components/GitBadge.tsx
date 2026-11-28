import type { ProjectSummary } from "../api/types";
import { Badge } from "./ui/badge";

type Git = Pick<ProjectSummary, "branch" | "detached" | "head" | "uncommitted" | "unpushed" | "upstream" | "gitError">;

// ブランチ名・未コミット・未 push（表示のみ。spec 4.1）。ブランチのピルの地は置かれた面が決める
export function GitBadge({ git, compact = false }: { git: Git; compact?: boolean }) {
  if (git.gitError && git.branch === null) return <Badge variant="destructive">Git: 読めません</Badge>;
  const branch = git.detached ? `(detached ${git.head?.slice(0, 7) ?? ""})` : (git.branch ?? "—");
  const unpushed = git.upstream === null ? (compact ? null : "upstream 無し") : `未 push ${git.unpushed ?? "?"}`;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      <Badge variant="neutral" className="font-mono wrap-anywhere whitespace-normal" title="ブランチ">
        {branch}
      </Badge>
      <Badge variant={git.uncommitted ? "warning" : "plain"}>
        {compact ? `変更 ${git.uncommitted ?? "?"}` : `未コミット ${git.uncommitted ?? "?"}`}
      </Badge>
      {unpushed && <Badge variant={git.unpushed ? "warning" : "plain"}>{unpushed}</Badge>}
    </span>
  );
}
