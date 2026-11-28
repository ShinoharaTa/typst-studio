import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../api/client";
import type { ImageCall, ImageList, UploadResult } from "../api/types";
import { useStudioEvent } from "../lib/hooks";
import type { ImageTarget } from "./ImageEditor";
import { Upload } from "lucide-react";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { List, ListItemContent, ListItemDescription, ListItemMedia, ListItemSplit, ListItemTitle } from "./ui/list";
import { PanelBar } from "./ui/panel";
import { Thumb } from "./ui/thumb";

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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      {/* アップロードの段は、一覧をスクロールしても上に残す */}
      <PanelBar className="sticky top-0 z-1">
        <Button onClick={() => input.current?.click()} disabled={uploading}>
          <Upload />
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
        <Alert
          action={
            file === props.article ? (
              <Button
                variant="primary"
                onClick={() => {
                  props.onInsert(uploaded.insert);
                  setUploaded(null);
                }}
              >
                カーソル位置に挿入
              </Button>
            ) : undefined
          }
        >
          <code className="block font-mono text-caption wrap-anywhere">{uploaded.insert}</code>
          {file !== props.article && (
            <p className="mt-2 text-caption text-muted-foreground">パスは記事（{props.article}）から見たものです。記事を開いて挿入してください</p>
          )}
        </Alert>
      )}
      {!isTyp && <EmptyState>.typ ファイルを開くと画像の一覧が出ます</EmptyState>}
      {error && <Alert variant="destructive">{error}</Alert>}
      {isTyp && list && list.calls.length === 0 && <EmptyState>このファイルに image( はありません</EmptyState>}
      <List className="images-list">
        {list?.calls.map((c) => (
          <li key={c.start}>
            {/* 本体（シートを開く）と行番号（ソースへ）の 2 つを押せる */}
            <ListItemSplit
              onClick={() => (c.editable ? props.onOpen({ call: c, rev: list.rev }) : props.onGoto(c))}
              actions={
                <Button variant="ghost" size="sm" onClick={() => props.onGoto(c)} aria-label={`${c.line} 行目のソースへ`}>
                  {c.line} 行
                </Button>
              }
            >
              <ListItemMedia>
                <Thumb src={c.resolved ? api.rawUrl(project, c.resolved) : null} />
              </ListItemMedia>
              <ListItemContent>
                <ListItemTitle className="font-mono">{c.src ?? "（式）"}</ListItemTitle>
                <ListItemDescription>
                  {c.editable
                    ? [c.width && `width ${c.width}`, c.height && `height ${c.height}`, c.alt && `alt「${c.alt}」`].filter(Boolean).join(" ・ ") ||
                      "サイズ指定なし"
                    : "編集不可"}
                </ListItemDescription>
              </ListItemContent>
            </ListItemSplit>
          </li>
        ))}
      </List>
    </div>
  );
}
