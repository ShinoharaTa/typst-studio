import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// 小さいピル（Git の状態・「前回」・保存の警告など）。文字は caption。
// neutral の地は置かれた面が決める（bg-box）。plain は地なし
export const badgeVariants = cva("inline-flex items-center rounded-pill px-2 py-0.5 text-caption whitespace-nowrap", {
  variants: {
    variant: {
      plain: "text-muted-foreground",
      neutral: "bg-box text-foreground",
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

// 押せるバッジ（記事のファイルへ戻る）。見た目はバッジのまま、押せる範囲を ::after で 44px 近くまで広げる
export function BadgeButton({ className, type = "button", ...props }: ComponentProps<"button">) {
  return (
    <button
      data-slot="badge-button"
      type={type}
      className={cn(
        badgeVariants({ variant: "neutral" }),
        "relative text-primary transition-colors duration-140 after:absolute after:-inset-x-1 after:-inset-y-3 hover:bg-box-press active:bg-box-press",
        className,
      )}
      {...props}
    />
  );
}
