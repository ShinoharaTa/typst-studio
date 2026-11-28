import type { ReactNode } from "react";
import type { PreviewStatus } from "../api/types";
import { articleTitle, type ArticleCtx } from "../lib/article-label";
import { Alert, AlertText } from "./ui/alert";
import { Button } from "./ui/button";

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
      <Alert variant="destructive">
        <p>プレビューを開始できません: {props.error}</p>
        <Button variant="surface" onClick={props.onStart}>
          もう一度
        </Button>
      </Alert>
    );
  } else if (props.starting || status?.state === "starting") {
    notice = <AlertText className="text-muted-foreground">プレビューを起動中…</AlertText>;
  } else if (status && status.state === "running" && !mine) {
    notice = (
      <Alert>
        <p>プレビューは別の記事（{status.project} / {status.article ? articleTitle(status.article, props.articleCtx) : ""}）を表示中です。</p>
        <Button variant="surface" onClick={props.onStart}>
          この記事で開く
        </Button>
      </Alert>
    );
  } else if (status && (status.state === "stopped" || status.state === "stopping")) {
    notice = (
      <Alert>
        <p>プレビューは停止しています{status.lastError ? `（${status.lastError}）` : ""}。</p>
        <Button variant="surface" onClick={props.onStart}>
          再開
        </Button>
      </Alert>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {props.compile && !props.compile.ok && running && (
        <p className="m-2 max-h-[30%] overflow-y-auto rounded-box bg-destructive-soft px-3 py-1.5 text-sm text-destructive wrap-anywhere" role="status">
          コンパイルエラー{props.compile.message ? `: ${props.compile.message}` : ""}
        </p>
      )}
      {notice}
      {running && (
        // startedAt が変われば（起動し直したら）読み込み直す
        <iframe key={status?.startedAt ?? ""} className="w-full flex-1 bg-paper" src="/preview/" title="記事プレビュー" />
      )}
    </div>
  );
}
