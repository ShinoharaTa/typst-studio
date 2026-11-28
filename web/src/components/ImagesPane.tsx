import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../api/client";
import type { ImageCall, ImageList, UploadResult } from "../api/types";
import { useStudioEvent } from "../lib/hooks";
import { ImageThumb, type ImageTarget } from "./ImageEditor";
import { Alert, AlertText } from "./ui/alert";
import { Button } from "./ui/button";
import { List } from "./ui/list";
import { PanelBar } from "./ui/panel";

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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-card">
      {/* アップロードの段は、一覧をスクロールしても上に残す */}
      <PanelBar className="sticky top-0 z-1">
        <Button onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? "アップロード中…" : "画像をアップロード"}
        </Button>
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
      </PanelBar>
      {uploaded && (
        <Alert>
          <code className="mb-2 block wrap-anywhere">{uploaded.insert}</code>
          {file === props.article ? (
            <Button
              variant="primary"
              onClick={() => {
                props.onInsert(uploaded.insert);
                setUploaded(null);
              }}
            >
              カーソル位置に挿入
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">パスは記事（{props.article}）から見たものです。記事を開いて挿入してください</p>
          )}
        </Alert>
      )}
      {!isTyp && <p className="p-4 text-muted-foreground">.typ ファイルを開くと画像の一覧が出ます</p>}
      {error && <AlertText variant="destructive">{error}</AlertText>}
      {isTyp && list && list.calls.length === 0 && <p className="p-4 text-muted-foreground">このファイルに image( はありません</p>}
      <List className="images-list">
        {list?.calls.map((c) => (
          <li key={c.start}>
            {/* 1 件 = パネルの上の箱。本体（シートを開く）と行番号（ソースへ）の 2 つを押せる */}
            <div className="flex min-h-16 items-center gap-1 rounded-box bg-secondary pr-2">
              <button
                type="button"
                className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-box px-3 py-2 text-left transition-colors duration-140 active:bg-secondary-press hover:bg-secondary-press"
                onClick={() => (c.editable ? props.onOpen({ call: c, rev: list.rev }) : props.onGoto(c))}
              >
                <ImageThumb src={c.resolved ? api.rawUrl(project, c.resolved) : null} />
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-sm wrap-anywhere">{c.src ?? "（式）"}</span>
                  <span className="text-sm text-muted-foreground">
                    {c.editable
                      ? [c.width && `width ${c.width}`, c.height && `height ${c.height}`, c.alt && `alt「${c.alt}」`]
                          .filter(Boolean)
                          .join(" ・ ") || "サイズ指定なし"
                      : "編集不可"}
                  </span>
                </span>
              </button>
              <Button variant="link" size="pill" className="bg-card px-3" onClick={() => props.onGoto(c)}>
                {c.line} 行
              </Button>
            </div>
          </li>
        ))}
      </List>
    </div>
  );
}
