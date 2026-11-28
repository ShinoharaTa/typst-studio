import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// 一覧の画面の本文（スクロールする部分）
export function ListMain({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      data-slot="list-main"
      className={cn("flex-1 overflow-y-auto overscroll-contain px-3 pt-1 pb-[calc(32px+env(safe-area-inset-bottom))]", className)}
      {...props}
    />
  );
}

// 一覧。行は 1 つずつ背景の上のパネル（線で区切らず、6px の隙間で分ける）
export function List({ className, ...props }: ComponentProps<"ul">) {
  return <ul data-slot="list" className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export function ListHeading({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      data-slot="list-heading"
      className={cn("mx-4 mt-6 mb-2 text-sm font-semibold text-muted-foreground wrap-anywhere", className)}
      {...props}
    />
  );
}

export const listItemVariants = cva(
  [
    "flex flex-col justify-center bg-card text-foreground no-underline wrap-anywhere",
    "transition-colors duration-140 active:bg-secondary-press hover:bg-secondary-press",
  ],
  {
    variants: {
      size: {
        default: "min-h-13 gap-0.5 rounded-row px-4 py-3",
        // プロジェクト一覧は 1 プロジェクト = 1 枚の大きめのパネル
        lg: "min-h-16 gap-1.5 rounded-panel px-4 py-3.5",
      },
    },
    defaultVariants: { size: "default" },
  },
);

// 行全体が 1 つのリンク
export function ListItemLink({ className, size, ...props }: ComponentProps<"a"> & VariantProps<typeof listItemVariants>) {
  return <a data-slot="list-item" className={cn(listItemVariants({ size }), className)} {...props} />;
}

export function ListItemTitle({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="list-item-title" className={cn("text-input font-semibold", className)} {...props} />;
}

export function ListItemDescription({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="list-item-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
