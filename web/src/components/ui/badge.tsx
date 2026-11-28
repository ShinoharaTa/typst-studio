import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// 小さいピル（Git の状態・「前回」・保存の警告など）。表示だけ
export const badgeVariants = cva("inline-flex items-center rounded-pill px-2 py-px text-xs whitespace-nowrap", {
  variants: {
    variant: {
      plain: "text-muted-foreground",
      // パネルの上（一覧の行の中）
      secondary: "bg-secondary text-foreground",
      // 背景の上（ヘッダ）
      surface: "bg-card text-foreground",
      accent: "bg-accent font-semibold text-primary",
      warning: "bg-warning-soft text-warning",
      destructive: "bg-destructive-soft font-semibold text-destructive",
    },
  },
  defaultVariants: { variant: "plain" },
});

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
