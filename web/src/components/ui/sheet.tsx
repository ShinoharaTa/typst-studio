import { Drawer } from "@base-ui/react/drawer";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// 下から出るシート（Base UI の Drawer に見た目を付けたもの）。置き場（.sheet-viewport・幅）は styles/screen.css
export const Sheet = Drawer.Root;

export function SheetContent({
  className,
  side,
  children,
  ...props
}: ComponentProps<typeof Drawer.Popup> & { side?: "left" | "right" | null }) {
  return (
    <Drawer.Portal>
      <Drawer.Viewport className="sheet-viewport" data-side={side ?? undefined}>
        <Drawer.Popup
          data-slot="sheet"
          className={cn(
            "sheet pointer-events-auto max-h-[min(70dvh,calc(100dvh-var(--kb)-48px))] overflow-y-auto overscroll-contain",
            "rounded-t-sheet bg-card px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] text-foreground shadow-float outline-0",
            // スワイプの量に追従する。出入りは下から
            "translate-y-[var(--drawer-swipe-movement-y,0px)] transition-[translate] duration-300 ease-drawer",
            "data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full data-[ending-style]:duration-200 data-[swiping]:duration-0",
            className as string,
          )}
          {...props}
        >
          <div className="mx-auto mt-1 mb-2 h-1 w-10 rounded-[2px] bg-secondary-press" aria-hidden />
          {children}
        </Drawer.Popup>
      </Drawer.Viewport>
    </Drawer.Portal>
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof Drawer.Title>) {
  return <Drawer.Title data-slot="sheet-title" className={cn("mb-2 text-base font-bold", className as string)} {...props} />;
}
