import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// ボタン。強さ 3（primary / secondary / ghost）+ 危険 1（destructive）、高さ 2（md 44 / sm 36）、形 1（角丸 box）。
// secondary の地は置かれた面が決める（bg-box。パネルの上は secondary、背景・通知・浮く面の上はその 1 段上）。
// sm は見た目が 36px でも、押せる範囲は ::after で 44px に広げる（sm を並べるときは 8px 以上空ける）。
// アイコンは lucide-react を中に置く（大きさはボタンが決める: md 20 / sm 16）。
// 呼ぶ側は className で地・文字・余白・角丸を変えない（置き場所と幅だけ）
export const buttonVariants = cva(
  [
    "relative inline-flex flex-none items-center justify-center gap-2 rounded-box whitespace-nowrap no-underline select-none",
    "transition-[transform,background-color,filter] duration-140 ease-out not-disabled:active:scale-97",
    "disabled:cursor-default [&_svg]:flex-none",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-primary font-semibold text-primary-foreground not-disabled:hover:brightness-108 not-disabled:active:brightness-92",
          // 無効は塗りをやめる（薄い青の普通のボタンに見せない）
          "disabled:bg-box disabled:font-normal disabled:text-muted-foreground",
        ],
        secondary: "bg-box text-foreground not-disabled:hover:bg-box-press not-disabled:active:bg-box-press disabled:text-muted-foreground",
        // 地なし。押したとき・ホバーだけ箱の地が出る
        ghost: "bg-transparent text-foreground not-disabled:hover:bg-box not-disabled:active:bg-box-press disabled:text-muted-foreground",
        destructive:
          "bg-destructive-soft text-destructive not-disabled:hover:bg-destructive-press not-disabled:active:bg-destructive-press disabled:opacity-50",
      },
      size: {
        md: "min-h-11 px-4 text-body [&_svg]:size-5",
        sm: "min-h-9 px-3 text-caption after:absolute after:-inset-1 [&_svg]:size-4",
      },
      // 正方形（アイコンだけ・短い文字だけ）
      icon: {
        true: "px-0",
        false: "",
      },
    },
    compoundVariants: [
      { size: "md", icon: true, className: "min-w-11" },
      { size: "sm", icon: true, className: "min-w-9" },
    ],
    defaultVariants: { variant: "secondary", size: "md", icon: false },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, icon, type = "button", ...props }: ButtonProps) {
  return <button data-slot="button" type={type} className={cn(buttonVariants({ variant, size, icon }), className)} {...props} />;
}
