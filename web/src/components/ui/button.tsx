import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// ボタン。地の色は「置かれた面より 1 段上」: パネルの上は secondary（default）、背景・通知の上は card（surface）
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1 whitespace-nowrap no-underline select-none",
    "transition-[transform,background-color,filter] duration-140 ease-out not-disabled:active:scale-[0.97]",
    "disabled:cursor-default disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        default: "bg-secondary text-foreground not-disabled:active:bg-secondary-press not-disabled:hover:bg-secondary-press",
        surface: "bg-card text-foreground not-disabled:active:bg-secondary-press not-disabled:hover:bg-secondary-press",
        primary: "bg-primary text-primary-foreground not-disabled:hover:brightness-108",
        destructive: "bg-destructive-soft text-destructive not-disabled:hover:brightness-97",
        ghost: "bg-transparent text-foreground not-disabled:active:bg-secondary-press not-disabled:hover:bg-secondary-press",
        // 文字だけのリンク風（地なし・primary の文字）
        link: "justify-start bg-transparent text-left text-primary not-disabled:active:scale-100",
        // 浮いているチップ（影あり。size="pill" と組む）。長い文言は末尾を省略する
        chip: "block truncate bg-card text-primary shadow-float",
      },
      size: {
        default: "min-h-11 rounded-box px-3.5",
        sm: "min-h-11 rounded-box px-3 text-sm",
        icon: "size-11 flex-none rounded-box text-icon",
        // 文字のボタン（「100%」など）。押せる大きさは icon と同じ
        text: "min-h-11 min-w-11 rounded-box px-1.5",
        pill: "min-h-11 rounded-pill px-4",
        // 文の中のリンク風（variant="link" と組む）
        inline: "min-h-11 px-1",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button data-slot="button" type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
