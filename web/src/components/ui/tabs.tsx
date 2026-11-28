import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

// 表示の切り替え。タブはトラック（背景より 1 段沈んだピル）にまとめ、選択中はその上の明るいピル。
// トラックで囲むので、外にあるボタンや記号キー（角丸 6px・パネルの中）とは別の部品に見える。
// 押すと URL（tab）が変わる切り替えなので、role="tab" ではなく aria-pressed のボタンにする
export function TabsList({ className, ...props }: ComponentProps<"nav">) {
  return <nav data-slot="tabs-list" className={cn("flex min-w-0 rounded-pill bg-tab-track p-[3px]", className)} {...props} />;
}

export function TabsTrigger({
  className,
  active,
  children,
  ...props
}: Omit<ComponentProps<"button">, "children"> & { active: boolean; children: ReactNode }) {
  return (
    <button
      data-slot="tabs-trigger"
      type="button"
      aria-pressed={active}
      className={cn(
        // 見た目は 38px（トラックで 44px）。押せる範囲は ::after でトラックの縁まで広げて 44px にする
        "relative min-h-[38px] min-w-0 flex-1 rounded-pill bg-transparent px-0.5 whitespace-nowrap text-muted-foreground",
        "after:absolute after:inset-x-0 after:-inset-y-[3px]",
        // 文字を大きくしても隣のタブに重ならないよう、上限を付けて末尾を省略する
        "text-[min(0.9rem,15px)]",
        "transition-colors duration-140 not-aria-pressed:active:bg-tab-press not-aria-pressed:hover:bg-tab-press",
        "aria-pressed:bg-tab-on aria-pressed:font-semibold aria-pressed:text-primary",
        className,
      )}
      {...props}
    >
      {/* 省略は中の文字で行う（ボタンに overflow を付けると、押せる範囲を広げる ::after が切られる） */}
      <span className="tab-label block truncate">{children}</span>
    </button>
  );
}
