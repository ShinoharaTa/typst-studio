import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, NoMemoryError } from "../api/client";
import type { BuildStatus, Diagnostic } from "../api/types";
import { useStudioEvent } from "../lib/hooks";
import { usePref } from "../lib/prefs";
import { AutoBuild, isBuildInput } from "../lib/schedule";
import { PdfViewer } from "./PdfViewer";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Disclosure, DisclosureSummary } from "./ui/disclosure";
import { Checkbox, Label, NativeSelect } from "./ui/input";
import { List, ListItem, ListItemButton, ListItemContent, ListItemDescription, ListItemTitle } from "./ui/list";
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

  // ビルドは本タブの主の操作（primary）。まだビルドされていないときは PDF の台の中央にも出す
  const buildButton = (
    <Button variant="primary" onClick={() => void build()} disabled={!profile}>
      {status?.state === "running" ? "ビルド中…" : status?.state === "queued" ? "待ち 1 件" : "ビルド"}
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
        {buildButton}
      </PanelBar>

      <PanelBar className="book-status flex-nowrap">
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
      </PanelBar>

      {error && <Alert variant="destructive">{error}</Alert>}
      {nomem && (
        <Alert variant="destructive" action={<Button onClick={() => void build(true)}>プレビューを止めてビルド</Button>}>
          空きメモリが足りないのでビルドできません
          {nomem.available !== undefined && nomem.required !== undefined ? `（空き ${mb(nomem.available)} / 必要 ${mb(nomem.required)}）` : ""}。
        </Alert>
      )}

      {diags.length > 0 && (
        <Disclosure className="mx-3 mb-2 max-h-[35%] flex-none overflow-y-auto" open={last ? !last.ok : false}>
          <DisclosureSummary>
            診断 {diags.length} 件（エラー {diags.filter((d) => d.severity === "error").length}）
          </DisclosureSummary>
          <List className="mt-2">
            {diags.map((d, i) => (
              <li key={i}>
                <DiagRow d={d} onGoto={props.onGoto} />
              </li>
            ))}
          </List>
        </Disclosure>
      )}

      <PdfViewer
        url={success?.pdfUrl ?? null}
        active={props.active}
        downloadUrl={success?.pdfUrl ?? null}
        empty={status?.state === "running" || status?.state === "queued" ? undefined : buildButton}
      />
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
        "book-summary min-h-11 min-w-0 flex-[0_1_auto] text-left text-caption",
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

// 診断の 1 件（一覧の行）。題は内容、説明は 重さ・場所。場所があれば押すとソースへ
function DiagRow({ d, onGoto }: { d: Diagnostic; onGoto(file: string, line: number, column: number): void }) {
  const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}${d.column ? `:${d.column}` : ""}` : "";
  const body = (
    <ListItemContent>
      <ListItemTitle>{d.message}</ListItemTitle>
      <ListItemDescription>
        <Badge variant={d.severity === "error" ? "destructive" : "warning"} className="mr-2">
          {d.severity === "error" ? "エラー" : "警告"}
        </Badge>
        {where && <span className="font-mono">{where}</span>}
      </ListItemDescription>
    </ListItemContent>
  );
  if (!d.file || !d.line) return <ListItem>{body}</ListItem>;
  return <ListItemButton onClick={() => onGoto(d.file!, d.line!, d.column ?? 1)}>{body}</ListItemButton>;
}
