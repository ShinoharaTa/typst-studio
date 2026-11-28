import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

// 選ぶ部品は 1 作り: トラック（置かれた面より 1 段沈んだピル）に並べ、選択中はその上の明るいピル + primary の文字。
//   TabsList / TabsTrigger: 表示（面）の切り替え。押すと URL（tab）が変わるので、role="tab" ではなく aria-pressed のボタン
//   SegmentGroup / SegmentItem: 値の選択（フォームの中。画像の幅の単位など）。role="group" の aria-pressed のボタン
// トラックは 44px、ピルは 36px。押せる範囲は ::after でトラックの縁まで広げて 44px にする
const track = "flex min-w-0 rounded-pill bg-tab-track p-1";
const trigger = [
  "relative min-h-9 min-w-0 rounded-pill bg-transparent px-3 whitespace-nowrap text-body text-muted-foreground",
  "after:absolute after:inset-x-0 after:-inset-y-1",
  "transition-colors duration-140 not-aria-pressed:hover:bg-tab-press not-aria-pressed:active:bg-tab-press",
  "aria-pressed:bg-tab-on aria-pressed:font-semibold aria-pressed:text-primary",
];

export function TabsList({ className, ...props }: ComponentProps<"nav">) {
  return <nav data-slot="tabs-list" className={cn(track, className)} {...props} />;
}

// kbCompact: キーボード表示中に「‹」と同じ段へ並ぶとき（1 ペインの編集画面）。文字を caption にし、幅は文字の長さに応じて分ける
export function TabsTrigger({
  className,
  active,
  kbCompact = false,
  children,
  ...props
}: Omit<ComponentProps<"button">, "children"> & { active: boolean; kbCompact?: boolean; children: ReactNode }) {
  return (
    <button
      data-slot="tabs-trigger"
      type="button"
      aria-pressed={active}
      className={cn(trigger, "flex-1 px-0.5", kbCompact && "kb:flex-auto kb:text-caption", className)}
      {...props}
    >
      {/* 省略は中の文字で行う（ボタンに overflow を付けると、押せる範囲を広げる ::after が切られる） */}
      <span className="tab-label block truncate">{children}</span>
    </button>
  );
}

export function SegmentGroup({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="segment-group" role="group" className={cn(track, "self-start", className)} {...props} />;
}

export function SegmentItem({ className, pressed, ...props }: ComponentProps<"button"> & { pressed: boolean }) {
  return <button data-slot="segment-item" type="button" aria-pressed={pressed} className={cn(trigger, "min-w-12", className)} {...props} />;
}
