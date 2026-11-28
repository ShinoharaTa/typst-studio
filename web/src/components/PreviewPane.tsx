import type { ReactNode } from "react";
import type { PreviewStatus } from "../api/types";
import { articleTitle, type ArticleCtx } from "../lib/article-label";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { Stage, StageFrame, StageSurface } from "./ui/panel";

// 記事プレビュー（tinymist を /preview/ で中継したもの）。タブを切り替えてもアンマウントしない
export function PreviewPane(props: {
  project: string;
  article: string;
  status: PreviewStatus | null;
  starting: boolean;
  error: string | null;
  compile: { ok: boolean; message?: string } | null;
  onStart(): void;
  articleCtx?: ArticleCtx;
}) {
  const { status, project, article } = props;
  const mine = status?.project === project && status?.article === article;
  const running = status?.state === "running" && mine;

  let notice: ReactNode = null;
  if (props.error) {
    notice = (
      <Alert variant="destructive" action={<Button onClick={props.onStart}>もう一度</Button>}>
        プレビューを開始できません: {props.error}
      </Alert>
    );
  } else if (status && status.state === "running" && !mine) {
    notice = (
      <Alert action={<Button onClick={props.onStart}>この記事で開く</Button>}>
        プレビューは別の記事（{status.project} / {status.article ? articleTitle(status.article, props.articleCtx) : ""}）を表示中です。
      </Alert>
    );
  } else if (status && (status.state === "stopped" || status.state === "stopping")) {
    notice = (
      <Alert action={<Button onClick={props.onStart}>再開</Button>}>
        プレビューは停止しています{status.lastError ? `（${status.lastError}）` : ""}。
      </Alert>
    );
  }
  const starting = !props.error && (props.starting || status?.state === "starting");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {props.compile && !props.compile.ok && running && (
        <Alert variant="destructive" size="sm" className="max-h-[30%] flex-none overflow-y-auto" role="status">
          コンパイルエラー{props.compile.message ? `: ${props.compile.message}` : ""}
        </Alert>
      )}
      {notice}
      {/* 紙の台は本タブの PDF と同じ作り（沈んだ面に角丸 box で置き、その上に紙） */}
      <Stage>
        <StageSurface className="overflow-hidden">
          {running && (
            // startedAt が変われば（起動し直したら）読み込み直す
            <StageFrame key={status?.startedAt ?? ""} src="/preview/" title="記事プレビュー" />
          )}
        </StageSurface>
        {starting && <EmptyState fill>プレビューを起動中…</EmptyState>}
      </Stage>
    </div>
  );
}
