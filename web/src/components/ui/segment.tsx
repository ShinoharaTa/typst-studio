import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";
import { buttonVariants } from "./button";

// 小さい選択肢の並び（画像の幅の単位など）。箱を並べ、選んだものは accent の地 + primary の文字
export function SegmentGroup({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="segment-group" role="group" className={cn("flex gap-1", className)} {...props} />;
}

export function SegmentItem({ className, pressed, ...props }: ComponentProps<"button"> & { pressed: boolean }) {
  return (
    <button
      data-slot="segment-item"
      type="button"
      aria-pressed={pressed}
      className={cn(
        buttonVariants(),
        "min-w-11 px-3 aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-primary",
        className,
      )}
      {...props}
    />
  );
}
