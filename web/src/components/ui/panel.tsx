import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// ペインの上端の操作の段（プロファイル・ビルド、状態、PDF のページ番号と拡大縮小、アップロード）。
// 左右の余白はペインの余白（12px）。段どうしの間は 8px: 前に段・通知（Alert）・診断（Disclosure）があるときは、
// それらの下の 8px（段の pb-2、通知の my-2、診断の mb-2）があるので、上の余白を詰める。
// 兄弟の要素で判定するので、間に display: contents の要素を挟まない（呼ぶ側は Fragment で並べる）
export function PanelBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-bar"
      className={cn(
        "surface-card flex flex-none flex-wrap items-center gap-2 px-3 py-2",
        "[:is([data-slot=panel-bar],[data-slot=alert],[data-slot=disclosure])+&]:pt-0",
        className,
      )}
      {...props}
    />
  );
}

// 紙の台（PDF とプレビュー）。パネルより沈んだ面に、角丸 box で置く。左右と下はペインの余白 12px
export function Stage({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="stage" className={cn("stage relative flex min-h-0 flex-1 flex-col", className)} {...props} />;
}

export function StageSurface({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="stage-surface" className={cn("min-h-0 flex-1 overflow-auto overscroll-contain rounded-box bg-pdf", className)} {...props} />;
}

// 台の上の紙（プレビューの iframe）
export function StageFrame({ className, ...props }: ComponentProps<"iframe">) {
  return <iframe data-slot="stage-frame" className={cn("block size-full bg-paper", className)} {...props} />;
}
