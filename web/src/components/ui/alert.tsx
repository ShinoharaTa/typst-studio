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

export type AlertProps = Omit<ComponentProps<"div">, "children" | "ref"> &
  VariantProps<typeof alertVariants> & { children: ReactNode; action?: ReactNode; as?: "div" | "span" };

// 文 + 任意の操作 1 つ（文の下に置く）。操作の強さは secondary（画面の主の操作と並べない）。
// 文の言い回しに合わせて primary にしてよいのは、その通知の操作が画面で唯一の操作のときだけ（アップロード後の「挿入」）。
// as="span": 一覧の行（ListItemContent は span）の中に置くとき
export function Alert({ className, variant, size, inset, action, as: Tag = "div", children, ...props }: AlertProps) {
  return (
    <Tag data-slot="alert" className={cn(alertVariants({ variant, size, inset }), Tag === "span" && "block", className)} {...props}>
      <Tag className="box-inside flex flex-col items-start gap-2">
        <Tag className="block self-stretch">{children}</Tag>
        {action}
      </Tag>
    </Tag>
  );
}
