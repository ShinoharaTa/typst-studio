import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, NoMemoryError } from "../api/client";
import type { BuildStatus, Diagnostic } from "../api/types";
import { useStudioEvent } from "../lib/hooks";
import { usePref } from "../lib/prefs";
import { AutoBuild, isBuildInput } from "../lib/schedule";
import { PdfViewer } from "./PdfViewer";
import { Alert, AlertText } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox, Label, NativeSelect } from "./ui/input";
import { PanelBar } from "./ui/panel";
import { cn } from "../lib/cn";

// 本全体のプレビュー（= 検証ビルド。spec 4.6 / 3.3.4）
export function BookPane(props: {
  project: string;
  // 「本」タブが見えている（自動ビルドはこの間だけ）
  active: boolean;
  onGoto(file: string, line: number, column: number): void;
  // 最後のビルドの診断（エディタの行表示に使う）
  onDiagnostics(d: Diagnostic[]): void;
}) {
  const { project } = props;
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profile, setProfile] = useState<string | null>(null);
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [nomem, setNomem] = useState<NoMemoryError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  // 自動ビルドのオン・オフ（端末ごと。読めなければオン）
  const [autoPref, setAutoPref] = usePref("typst-studio.autoBuild", "on");
  const autoOn = autoPref !== "off";

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
    async (stopPreview = false, manual = true) => {
      const p = profileRef.current;
      if (!p) return;
      try {
        const s = await api.build(project, p, stopPreview);
        setNomem(null);
        setError(null);
        const { accepted, ...st } = s;
        setStatus(st);
        // 待ちが埋まっていると、何もせずに 202 と accepted: "dropped" が返る
        if (manual && accepted === "dropped") toast.info("ほかのビルドの待ちがあるので受け付けられませんでした。終わってからもう一度押してください");
        else if (manual && accepted === "queued") toast.info("今のビルドが終わったらもう一度ビルドします");
      } catch (e) {
        if (e instanceof NoMemoryError) setNomem(e);
        else toast.error(`ビルドを始められません: ${(e as Error).message}`);
      }
    },
    [project],
  );

  const auto = useMemo(() => new AutoBuild(() => void build(false, false)), [build]);
  useEffect(() => () => auto.dispose(), [auto]);
  useEffect(() => auto.setActive(props.active && autoOn), [auto, props.active, autoOn]);

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
  const diags = useMemo(() => last?.diagnostics ?? [], [last]);
  const onDiagnostics = props.onDiagnostics;
  useEffect(() => onDiagnostics(diags), [diags, onDiagnostics]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      {/* 1 行目はプロファイルとビルドだけ（スマホで PDF の場所を空ける）。ダウンロードは PDF のバー、自動ビルドは状態の行へ */}
      <PanelBar className="book-bar flex-nowrap">
        <NativeSelect
          className="flex-1"
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
        </NativeSelect>
        <Button variant="primary" className="flex-none" onClick={() => void build()} disabled={!profile}>
          {status?.state === "running" ? "ビルド中…" : status?.state === "queued" ? "待ち 1 件" : "ビルド"}
        </Button>
      </PanelBar>

      <div className="book-status flex flex-none flex-nowrap items-center gap-x-2 gap-y-1 px-3 pb-1.5">
        <BuildSummary status={status} />
        {status?.stale && (
          <Badge variant="warning" className="flex-none">
            未反映の変更あり
          </Badge>
        )}
        <Label className="ml-auto flex-none">
          <Checkbox checked={autoOn} onChange={(e) => setAutoPref(e.target.checked ? "on" : "off")} />
          自動ビルド
        </Label>
      </div>

      {error && <AlertText variant="destructive">{error}</AlertText>}
      {nomem && (
        <Alert variant="destructive">
          <p>
            空きメモリが足りないのでビルドできません
            {nomem.available !== undefined && nomem.required !== undefined
              ? `（空き ${mb(nomem.available)} / 必要 ${mb(nomem.required)}）`
              : ""}
            。
          </p>
          <Button variant="surface" onClick={() => void build(true)}>
            プレビューを止めてビルド
          </Button>
        </Alert>
      )}

      {diags.length > 0 && (
        <details className="mx-2 mb-2 max-h-[35%] flex-none overflow-y-auto" open={last ? !last.ok : false}>
          <summary className="flex min-h-11 cursor-pointer items-center rounded-box bg-secondary px-3">
            診断 {diags.length} 件（エラー {diags.filter((d) => d.severity === "error").length}）
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {diags.map((d, i) => (
              <li key={i}>
                <DiagRow d={d} onGoto={props.onGoto} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <PdfViewer url={success?.pdfUrl ?? null} active={props.active} downloadUrl={success?.pdfUrl ?? null} />
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

export function buildSummaryText(status: BuildStatus | null): string {
  const last = status?.last;
  if (!last) return status?.state === "running" ? "ビルド中…" : "ビルド履歴なし";
  const time = new Date(last.finishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = [
    last.ok ? "成功" : `失敗（${REASON[last.reason] ?? last.reason}）`,
    time,
    `${(last.durationMs / 1000).toFixed(1)} 秒`,
    `警告 ${last.warnings}`,
  ];
  if (status?.state === "running") parts.push("ビルド中…");
  if (status?.state === "queued") parts.push("待ち 1 件");
  return parts.join(" ・ ");
}

// 状態の行は 1 行に収め、はみ出す分は省略する（タップで全文）
function BuildSummary({ status }: { status: BuildStatus | null }) {
  const [expanded, setExpanded] = useState(false);
  const text = buildSummaryText(status);
  const failed = status?.last ? !status.last.ok : false;
  return (
    <button
      type="button"
      className={cn(
        "book-summary min-h-11 min-w-0 flex-[0_1_auto] text-left text-sm",
        expanded ? "overflow-hidden wrap-anywhere" : "truncate",
        failed && "text-destructive",
      )}
      data-expanded={expanded}
      aria-expanded={expanded}
      title={text}
      onClick={() => setExpanded((x) => !x)}
    >
      {text}
    </button>
  );
}

// 診断の 1 件（パネルの上の箱）
const DIAG = "flex w-full min-h-11 flex-wrap gap-x-2 gap-y-0.5 rounded-box bg-secondary px-3 py-2 text-left text-sm wrap-anywhere";

function DiagRow({ d, onGoto }: { d: Diagnostic; onGoto(file: string, line: number, column: number): void }) {
  const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}${d.column ? `:${d.column}` : ""}` : "";
  const body = (
    <>
      <span className={cn("font-semibold", d.severity === "error" ? "text-destructive" : "text-warning")}>
        {d.severity === "error" ? "エラー" : "警告"}
      </span>
      {where && <span className="font-mono text-primary">{where}</span>}
      <span className="basis-full">{d.message}</span>
    </>
  );
  if (!d.file || !d.line) return <div className={DIAG}>{body}</div>;
  return (
    <button
      type="button"
      className={cn(DIAG, "transition-colors duration-140 active:bg-secondary-press hover:bg-secondary-press")}
      onClick={() => onGoto(d.file!, d.line!, d.column ?? 1)}
    >
      {body}
    </button>
  );
}
