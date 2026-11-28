import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// エディタの上に浮くもの（浮く面・影あり）。
//   Chip: 「ソースへ」のチップ（ピル）。長い文言は末尾を省略する。icon は × などアイコンだけの丸いチップ
//   Banner: カーソルのある行の診断の帯（角丸 float）。tone の色はアイコンと見出しの文字だけに付ける
export function Chip({ className, icon = false, type = "button", ...props }: ComponentProps<"button"> & { icon?: boolean }) {
  return (
    <button
      data-slot="chip"
      type={type}
      className={cn(
        "surface-popover inline-flex min-h-11 items-center justify-center gap-2 rounded-pill text-body text-primary shadow-float [&_svg]:size-5",
        "transition-[transform,background-color] duration-140 active:scale-97 hover:bg-box active:bg-box",
        icon ? "w-11 flex-none text-muted-foreground" : "block min-w-0 truncate px-4 leading-11",
        className,
      )}
      {...props}
    />
  );
}

export function Banner({ className, tone, type = "button", ...props }: ComponentProps<"button"> & { tone: "destructive" | "warning" }) {
  return (
    <button
      data-slot="banner"
      data-tone={tone}
      type={type}
      className={cn(
        "surface-popover flex min-h-11 w-full items-start gap-2 rounded-float px-4 py-3 text-left text-caption text-foreground shadow-float wrap-anywhere [&_svg]:mt-px [&_svg]:size-4 [&_svg]:flex-none",
        tone === "destructive" ? "[&_svg]:text-destructive" : "[&_svg]:text-warning",
        className,
      )}
      {...props}
    />
  );
}
