import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// エディタの入力補助。エディタと同じパネルの面に載せ、キーはその上の箱の地（背景色の溝で切り離さない）
export function Toolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar"
      role="toolbar"
      className={cn("surface-card flex flex-none items-center gap-1 overflow-x-auto [scrollbar-width:none]", className)}
      {...props}
    />
  );
}

// キー（高さ 44・角丸 box・本文の大きさ）。aria-disabled のキーには押した・ホバーの反応を出さない。
//   kind: icon（アイコン 1 つ）/ glyph（挿入する記号。等幅で、残りの幅を分け合う）/ save（保存。状態を地と文字で示す）
//   tone（save だけ）: 状態の見せ方。quiet = 保存済・保存中（地なし・muted）/ accent = 未保存 / destructive = 衝突・失敗
export const toolbarKeyVariants = cva(
  [
    "h-11 flex-none rounded-box text-body text-foreground [&_svg]:size-5",
    "inline-flex items-center justify-center",
    "transition-[transform,background-color] duration-140 ease-out",
    "not-disabled:not-aria-disabled:active:scale-97",
    "disabled:cursor-default disabled:opacity-50 aria-disabled:cursor-default",
  ],
  {
    variants: {
      kind: {
        icon: "min-w-11 bg-box not-disabled:not-aria-disabled:hover:bg-box-press not-disabled:not-aria-disabled:active:bg-box-press",
        glyph:
          "min-w-7 flex-1 bg-box px-0 font-mono not-disabled:not-aria-disabled:hover:bg-box-press not-disabled:not-aria-disabled:active:bg-box-press",
        // 文言が変わってもキーの並びがずれないよう幅を固定し、折り返さない。太さは全状態で同じ。
        // 画像シートを開いている間（ツールバーが data-locked）は、ほかのキーと同じく薄くする
        save: "w-12 px-0 font-semibold whitespace-nowrap in-data-[locked=true]:opacity-50",
      },
      tone: {
        quiet: "bg-transparent text-muted-foreground",
        accent: "bg-accent text-primary",
        destructive: "bg-destructive-soft text-destructive",
      },
    },
    defaultVariants: { kind: "icon" },
  },
);

export function ToolbarKey({ className, kind, tone, ...props }: ComponentProps<"button"> & VariantProps<typeof toolbarKeyVariants>) {
  return <button data-slot="toolbar-key" type="button" className={cn(toolbarKeyVariants({ kind, tone }), className)} {...props} />;
}

// キーの組の間は、線ではなく余白で分ける
export function ToolbarGap({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="toolbar-gap" aria-hidden className={cn("w-1 flex-none", className)} {...props} />;
}
