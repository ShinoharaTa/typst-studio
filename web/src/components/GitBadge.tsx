import type { ProjectSummary } from "../api/types";

type Git = Pick<ProjectSummary, "branch" | "detached" | "head" | "uncommitted" | "unpushed" | "upstream" | "gitError">;

// ブランチ名・未コミット・未 push（表示のみ。spec 4.1）
export function GitBadge({ git, compact = false }: { git: Git; compact?: boolean }) {
  if (git.gitError && git.branch === null) return <span className="git git-error">Git: 読めません</span>;
  const branch = git.detached ? `(detached ${git.head?.slice(0, 7) ?? ""})` : (git.branch ?? "—");
  const unpushed = git.upstream === null ? (compact ? null : "upstream 無し") : `未 push ${git.unpushed ?? "?"}`;
  return (
    <span className="git">
      <span className="git-branch" title="ブランチ">
        {branch}
      </span>
      <span className={git.uncommitted ? "git-count warn" : "git-count"}>
        {compact ? `変更 ${git.uncommitted ?? "?"}` : `未コミット ${git.uncommitted ?? "?"}`}
      </span>
      {unpushed && <span className={git.unpushed ? "git-count warn" : "git-count"}>{unpushed}</span>}
    </span>
  );
}
