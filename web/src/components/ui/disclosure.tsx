import { ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// 開閉する一覧（診断など）。見出しは一覧の行と同じ箱で、先頭の矢印で開閉できることを示す（開くと下向き）
export function Disclosure({ className, ...props }: ComponentProps<"details">) {
  return <details data-slot="disclosure" className={cn("group", className)} {...props} />;
}

export function DisclosureSummary({ className, children, ...props }: ComponentProps<"summary">) {
  return (
    <summary
      data-slot="disclosure-summary"
      className={cn(
        "flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-box bg-box px-3 text-body [&::-webkit-details-marker]:hidden",
        "transition-colors duration-140 hover:bg-box-press active:bg-box-press",
        className,
      )}
      {...props}
    >
      <ChevronRight className="size-4 flex-none text-muted-foreground transition-transform duration-140 group-open:rotate-90" aria-hidden />
      {children}
    </summary>
  );
}
