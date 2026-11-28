import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../api/client";
import type { ImageCall, ImageList, UploadResult } from "../api/types";
import { useStudioEvent } from "../lib/hooks";
import type { ImageTarget } from "./ImageEditor";

// 画像タブ: 開いているファイルの image( 呼び出しの一覧（記事内の出現順）と、アップロード（spec 4.4 / 4.5）
export function ImagesPane(props: {
  project: string;
  article: string;
  file: string;
  // 画像シートを閉じたときなどに増やして読み直させる
  refreshKey: number;
  onOpen(t: ImageTarget): void;
  onGoto(call: ImageCall): void;
  onInsert(text: string): void;
}) {
  const { project, file } = props;
  const [list, setList] = useState<ImageList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const isTyp = file.endsWith(".typ");

  const reload = useCallback(() => {
    if (!isTyp) return;
    api.images(project, file).then(
      (l) => {
        setList(l);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [project, file, isTyp]);

  useEffect(reload, [reload, props.refreshKey]);

  useStudioEvent((e) => {
    if (e.type === "file-changed" && e.project === project && e.path === file && e.rev !== list?.rev) reload();
  }, reload);

  const upload = async (f: File) => {
    setUploading(true);
    try {
      const r = await api.upload(project, props.article, f);
      setUploaded(r);
      toast.success(`${r.path} にアップロードしました`);
    } catch (e) {
      toast.error(`アップロードできません: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="images-pane">
      <div className="pane-bar">
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? "アップロード中…" : "画像をアップロード"}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
      </div>
      {uploaded && (
        <div className="notice">
          <code className="insert-code">{uploaded.insert}</code>
          {file === props.article ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                props.onInsert(uploaded.insert);
                setUploaded(null);
              }}
            >
              カーソル位置に挿入
            </button>
          ) : (
            <p className="muted small">パスは記事（{props.article}）から見たものです。記事を開いて挿入してください</p>
          )}
        </div>
      )}
      {!isTyp && <p className="muted pad">.typ ファイルを開くと画像の一覧が出ます</p>}
      {error && <p className="notice error">{error}</p>}
      {isTyp && list && list.calls.length === 0 && <p className="muted pad">このファイルに image( はありません</p>}
      <ul className="list">
        {list?.calls.map((c) => (
          <li key={c.start}>
            <div className="img-row">
              <button
                type="button"
                className="img-row-main"
                onClick={() => (c.editable ? props.onOpen({ call: c, rev: list.rev }) : props.onGoto(c))}
              >
                {c.resolved ? (
                  <img className="img-thumb" src={api.rawUrl(project, c.resolved)} alt="" loading="lazy" />
                ) : (
                  <span className="img-thumb img-thumb-none">?</span>
                )}
                <span className="img-row-text">
                  <span className="img-src">{c.src ?? "（式）"}</span>
                  <span className="muted small">
                    {c.editable
                      ? [c.width && `width ${c.width}`, c.height && `height ${c.height}`, c.alt && `alt「${c.alt}」`]
                          .filter(Boolean)
                          .join(" ・ ") || "サイズ指定なし"
                      : "編集不可"}
                  </span>
                </span>
              </button>
              <button type="button" className="link-btn" onClick={() => props.onGoto(c)}>
                {c.line} 行
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
