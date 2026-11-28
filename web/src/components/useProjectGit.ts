import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { ProjectSummary } from "../api/types";
import { useStudioEvent } from "../lib/hooks";

// 1 プロジェクトの Git 状態。git-changed で更新する
export function useProjectGit(project: string): ProjectSummary | null {
  const [git, setGit] = useState<ProjectSummary | null>(null);
  const reload = useCallback(() => {
    api.projects().then(
      (l) => setGit(l.find((p) => p.name === project) ?? null),
      () => undefined,
    );
  }, [project]);
  useEffect(reload, [reload]);
  useStudioEvent((e) => {
    if (e.type === "git-changed" && e.project === project) {
      const { type: _t, project: _p, ...rest } = e;
      setGit((g) => (g ? { ...g, ...rest } : g));
    }
  }, reload);
  return git;
}
