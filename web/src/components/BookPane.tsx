import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, NoMemoryError } from "../api/client";
import type { BuildStatus, Diagnostic } from "../api/types";
import { useStudioEvent } from "../lib/hooks";
import { AutoBuild, isBuildInput } from "../lib/schedule";
import { PdfViewer } from "./PdfViewer";

// 本全体のプレビュー（= 検証ビルド。spec 4.6 / 3.3.4）
export function BookPane(props: {
  project: string;
  // 「本」タブが見えている（自動ビルドはこの間だけ）
  active: boolean;
  onGoto(file: string, line: number, column: number): void;
}) {
  const { project } = props;
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profile, setProfile] = useState<string | null>(null);
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [nomem, setNomem] = useState<NoMemoryError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useEffect(() => {
    api.profiles(project).then(
      (p) => {
        setProfiles(p.profiles);
        setProfile((cur) => cur ?? p.default ?? p.profiles[0] ?? null);
      },
      (e: Error) => setError(e.message),
    );
  }, [project]);

  const loadStatus = useCallback(() => {
    if (!profile) return;
    api.buildStatus(project, profile).then(setStatus, (e: Error) => setError(e.message));
  }, [project, profile]);
  useEffect(loadStatus, [loadStatus]);

  const build = useCallback(
    async (stopPreview = false) => {
      const p = profileRef.current;
      if (!p) return;
      try {
        const s = await api.build(project, p, stopPreview);
        setNomem(null);
        setError(null);
        setStatus(s);
      } catch (e) {
        if (e instanceof NoMemoryError) setNomem(e);
        else toast.error(`ビルドを始められません: ${(e as Error).message}`);
      }
    },
    [project],
  );

  const auto = useMemo(() => new AutoBuild(() => void build()), [build]);
  useEffect(() => () => auto.dispose(), [auto]);
  useEffect(() => auto.setActive(props.active), [auto, props.active]);

  useStudioEvent((e) => {
    if (e.type === "build-status" && e.project === project && e.profile === profileRef.current) {
      const { type: _t, ...s } = e;
      setStatus(s);
    } else if (e.type === "file-changed" && e.project === project && isBuildInput(e.path)) {
      auto.notify();
    }
  }, loadStatus);

  const last = status?.last;
  const success = status?.lastSuccess;
  const diags = last?.diagnostics ?? [];

  return (
    <div className="book-pane">
      <div className="pane-bar">
        <select
          className="select"
          value={profile ?? ""}
          onChange={(e) => setProfile(e.target.value)}
          aria-label="プロファイル"
          disabled={profiles.length === 0}
        >
          {profiles.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={() => void build()} disabled={!profile}>
          {status?.state === "running" ? "ビルド中…" : status?.state === "queued" ? "待ち 1 件" : "ビルド"}
        </button>
        {success?.pdfUrl && (
          <a className="btn" href={success.pdfUrl} download>
            ダウンロード
          </a>
        )}
      </div>

      <div className="book-status">
        <BuildSummary status={status} />
        {status?.stale && <span className="badge warn">未反映の変更あり</span>}
      </div>

      {error && <p className="notice error">{error}</p>}
      {nomem && (
        <div className="notice error">
          <p>
            空きメモリが足りないのでビルドできません
            {nomem.available !== undefined && nomem.required !== undefined
              ? `（空き ${mb(nomem.available)} / 必要 ${mb(nomem.required)}）`
              : ""}
            。
          </p>
          <button type="button" className="btn" onClick={() => void build(true)}>
            プレビューを止めてビルド
          </button>
        </div>
      )}

      {diags.length > 0 && (
        <details className="diags" open={last ? !last.ok : false}>
          <summary>
            診断 {diags.length} 件（エラー {diags.filter((d) => d.severity === "error").length}）
          </summary>
          <ul className="diag-list">
            {diags.map((d, i) => (
              <li key={i}>
                <DiagRow d={d} onGoto={props.onGoto} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <PdfViewer url={success?.pdfUrl ?? null} />
    </div>
  );
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

const REASON: Record<string, string> = {
  error: "コンパイルエラー",
  limit: "上限超過",
  timeout: "時間切れ",
  stopped: "停止",
  nomem: "メモリ不足",
};

function BuildSummary({ status }: { status: BuildStatus | null }) {
  const last = status?.last;
  if (!last) return <span className="muted small">{status?.state === "running" ? "ビルド中…" : "ビルド履歴なし"}</span>;
  const time = new Date(last.finishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <span className="small">
      {last.ok ? "成功" : `失敗（${REASON[last.reason] ?? last.reason}）`} ・ {time} ・ {(last.durationMs / 1000).toFixed(1)} 秒 ・ 警告{" "}
      {last.warnings}
      {status?.state === "running" && " ・ ビルド中…"}
      {status?.state === "queued" && " ・ 待ち 1 件"}
    </span>
  );
}

function DiagRow({ d, onGoto }: { d: Diagnostic; onGoto(file: string, line: number, column: number): void }) {
  const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}${d.column ? `:${d.column}` : ""}` : "";
  const body = (
    <>
      <span className={d.severity === "error" ? "diag-sev error" : "diag-sev warn"}>{d.severity === "error" ? "エラー" : "警告"}</span>
      {where && <span className="diag-where">{where}</span>}
      <span className="diag-msg">{d.message}</span>
    </>
  );
  if (!d.file || !d.line) return <div className="diag">{body}</div>;
  return (
    <button type="button" className="diag diag-link" onClick={() => onGoto(d.file!, d.line!, d.column ?? 1)}>
      {body}
    </button>
  );
}
