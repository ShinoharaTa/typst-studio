import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// 通知の箱（読み込みの失敗・プレビューの状態など）。中のボタンは variant="surface"（箱より 1 段上の色）
export const alertVariants = cva("mx-3 my-2 rounded-box px-3 py-2.5 wrap-anywhere [&_p]:mb-2 [&_p:last-child]:mb-0", {
  variants: {
    variant: {
      default: "bg-secondary text-foreground",
      destructive: "bg-destructive-soft text-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

type AlertProps = VariantProps<typeof alertVariants> & { className?: string };

export function Alert({ className, variant, ...props }: ComponentProps<"div"> & AlertProps) {
  return <div data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

// 1 文だけの通知
export function AlertText({ className, variant, ...props }: ComponentProps<"p"> & AlertProps) {
  return <p data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
