import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// 面。線を使わず、置かれた面との色の差で区切る（card = パネル、secondary = パネルの上の箱、pdf = パネルより沈んだ台）
export const panelVariants = cva("", {
  variants: {
    level: {
      card: "bg-card text-foreground",
      secondary: "bg-secondary text-foreground",
      pdf: "bg-pdf",
    },
    radius: {
      box: "rounded-box",
      panel: "rounded-panel",
      none: "",
    },
  },
  defaultVariants: { level: "card", radius: "box" },
});

export function Panel({ className, level, radius, ...props }: ComponentProps<"div"> & VariantProps<typeof panelVariants>) {
  return <div data-slot="panel" className={cn(panelVariants({ level, radius }), className)} {...props} />;
}

// ペインの上端の操作の段（プロファイル・ビルド、アップロード、PDF のページ番号と拡大縮小）
export function PanelBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="panel-bar" className={cn("flex flex-none flex-wrap items-center gap-2 bg-card px-3 py-2", className)} {...props} />
  );
}
