import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

// 通知の箱（読み込みの失敗・プレビューの状態・コンパイルエラーなど）。エラーの箱はこれだけを使う。
//   variant: default（置かれた面の箱の地）/ destructive
//   size: md（本文）/ sm（caption。編集ペインの注意など、上に重ねて高さを取りたくないもの）
//   inset: pane（ペインの中。左右はペインの余白 12px）/ none（シート・行の中など、置く側が並べる）
// 中のボタンは secondary のまま置けば、箱の中の箱の地になる（box-inside）
export const alertVariants = cva("rounded-box px-3 wrap-anywhere", {
  variants: {
    variant: {
      default: "bg-box text-foreground",
      destructive: "bg-destructive-soft text-destructive",
    },
    size: {
      md: "py-3 text-body",
      sm: "py-2 text-caption",
    },
    inset: {
      pane: "mx-3 my-2",
      none: "",
    },
  },
  defaultVariants: { variant: "default", size: "md", inset: "pane" },
});

export type AlertProps = Omit<ComponentProps<"div">, "children"> & VariantProps<typeof alertVariants> & { children: ReactNode; action?: ReactNode };

// 文 + 任意の操作 1 つ（文の下に置く）
export function Alert({ className, variant, size, inset, action, children, ...props }: AlertProps) {
  return (
    <div data-slot="alert" className={cn(alertVariants({ variant, size, inset }), className)} {...props}>
      <div className="box-inside flex flex-col items-start gap-2">
        <div className="self-stretch">{children}</div>
        {action}
      </div>
    </div>
  );
}
