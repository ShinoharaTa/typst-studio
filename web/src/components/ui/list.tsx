import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

// 一覧の画面の本文（スクロールする部分）。中身は最大幅 640px で中央に置く
export function ListMain({ className, children, ...props }: ComponentProps<"main">) {
  return (
    <main
      data-slot="list-main"
      className={cn("flex-1 overflow-y-auto overscroll-contain px-3 pt-1 pb-[calc(32px+env(safe-area-inset-bottom))]", className)}
      {...props}
    >
      <div className="mx-auto w-full max-w-list">{children}</div>
    </main>
  );
}

// 一覧。行は 1 つずつの箱（線で区切らず、8px の隙間で分ける）
export function List({ className, ...props }: ComponentProps<"ul">) {
  return <ul data-slot="list" className={cn("flex flex-col gap-2", className)} {...props} />;
}

// グループの見出し。左端は行の文字に揃える（行の内側の余白と同じ 12px）
export function ListHeading({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2 data-slot="list-heading" className={cn("mx-3 mt-6 mb-2 text-caption font-semibold text-muted-foreground wrap-anywhere", className)} {...props} />
  );
}

// 一覧の行は 1 部品。構成は 先頭（サムネ）・本文（題 + 説明）・末尾（操作）。
// 地は置かれた面が決める（背景の上は card、パネルの上は secondary）。角丸は箱（10px）。内側の余白は 12px
const row = "flex min-h-13 w-full items-center gap-3 rounded-box bg-box px-3 py-2 text-left text-foreground no-underline wrap-anywhere";
const press = "transition-colors duration-140 hover:bg-box-press active:bg-box-press";

// 押せない行（中に別々に押せるものを持つときは ListItemSplit）
export function ListItem({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="list-item" className={cn(row, className)} {...props} />;
}

// 行全体が 1 つのリンク
export function ListItemLink({ className, ...props }: ComponentProps<"a">) {
  return <a data-slot="list-item" className={cn(row, press, className)} {...props} />;
}

// 行全体が 1 つのボタン
export function ListItemButton({ className, type = "button", ...props }: ComponentProps<"button">) {
  return <button data-slot="list-item" type={type} className={cn(row, press, className)} {...props} />;
}

// 本体（押すと開く）と末尾の操作を別々に押せる行。本体はボタン、操作は actions に置く
export function ListItemSplit({
  className,
  actions,
  type = "button",
  ...props
}: ComponentProps<"button"> & { actions: ReactNode }) {
  return (
    <div data-slot="list-item" className="flex w-full items-center rounded-box bg-box pr-2 wrap-anywhere">
      <button type={type} className={cn(row, press, "min-w-0 flex-1 bg-transparent", className)} {...props} />
      <ListItemActions>{actions}</ListItemActions>
    </div>
  );
}

export function ListItemMedia({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="list-item-media" className={cn("box-inside flex flex-none", className)} {...props} />;
}

export function ListItemContent({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="list-item-content" className={cn("box-inside flex min-w-0 flex-1 flex-col items-start gap-0.5", className)} {...props} />;
}

export function ListItemActions({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="list-item-actions" className={cn("box-inside flex flex-none items-center gap-2", className)} {...props} />;
}

export function ListItemTitle({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="list-item-title" className={cn("text-body font-semibold", className)} {...props} />;
}

// 題の上の小さい見出し（「続きから」など。アイコンを前に置ける）
export function ListItemEyebrow({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="list-item-eyebrow"
      className={cn("inline-flex items-center gap-1 text-caption font-semibold text-primary [&_svg]:size-3 [&_svg]:fill-current", className)}
      {...props}
    />
  );
}

export function ListItemDescription({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="list-item-description" className={cn("text-caption text-muted-foreground", className)} {...props} />;
}
