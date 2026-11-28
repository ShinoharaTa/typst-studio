import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// エディタの入力補助。エディタと同じパネルの面に載せ、キーは 1 段上の secondary（背景色の溝で切り離さない）
export function Toolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar"
      role="toolbar"
      className={cn("flex flex-none items-center gap-1 overflow-x-auto bg-card [scrollbar-width:none]", className)}
      {...props}
    />
  );
}

// キー。角丸 6px（キーボードのキーに寄せ、タブのピル・ボタンの 10px と形で見分ける）。
// aria-disabled のキーには押した・ホバーの反応を出さない
export function ToolbarKey({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      data-slot="toolbar-key"
      type="button"
      className={cn(
        "h-11 min-w-11 flex-none rounded-key bg-secondary text-md text-foreground",
        "transition-[transform,background-color] duration-140 ease-out",
        "not-disabled:not-aria-disabled:active:scale-[0.97] not-disabled:not-aria-disabled:active:bg-secondary-press",
        "not-disabled:not-aria-disabled:hover:bg-secondary-press",
        "disabled:opacity-50 aria-disabled:cursor-default",
        className,
      )}
      {...props}
    />
  );
}

// キーの組の間は、線ではなく余白で分ける
export function ToolbarGap({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="toolbar-gap" aria-hidden className={cn("w-1 flex-none", className)} {...props} />;
}
