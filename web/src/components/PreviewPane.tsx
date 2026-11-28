import type { ReactNode } from "react";
import type { PreviewStatus } from "../api/types";
import { articleTitle, type ArticleCtx } from "../lib/article-label";

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
      <div className="notice error">
        <p>プレビューを開始できません: {props.error}</p>
        <button type="button" className="btn" onClick={props.onStart}>
          もう一度
        </button>
      </div>
    );
  } else if (props.starting || status?.state === "starting") {
    notice = <p className="notice muted">プレビューを起動中…</p>;
  } else if (status && status.state === "running" && !mine) {
    notice = (
      <div className="notice">
        <p>プレビューは別の記事（{status.project} / {status.article ? articleTitle(status.article, props.articleCtx) : ""}）を表示中です。</p>
        <button type="button" className="btn" onClick={props.onStart}>
          この記事で開く
        </button>
      </div>
    );
  } else if (status && (status.state === "stopped" || status.state === "stopping")) {
    notice = (
      <div className="notice">
        <p>プレビューは停止しています{status.lastError ? `（${status.lastError}）` : ""}。</p>
        <button type="button" className="btn" onClick={props.onStart}>
          再開
        </button>
      </div>
    );
  }

  return (
    <div className="preview-pane">
      {props.compile && !props.compile.ok && running && (
        <p className="preview-compile error" role="status">
          コンパイルエラー{props.compile.message ? `: ${props.compile.message}` : ""}
        </p>
      )}
      {notice}
      {running && (
        // startedAt が変われば（起動し直したら）読み込み直す
        <iframe key={status?.startedAt ?? ""} className="preview-frame" src="/preview/" title="記事プレビュー" />
      )}
    </div>
  );
}
