import { Drawer } from "@base-ui/react/drawer";
import type { ComponentProps } from "react";
import { cn, cnState } from "../../lib/cn";

// 下から出るシート（Base UI の Drawer に見た目を付けたもの）。浮く面（popover・角丸 float）。
// 置き場（.sheet-viewport・幅）は styles/screen.css
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
          className={cnState(
            cn(
              "sheet pointer-events-auto max-h-[min(70dvh,calc(100dvh-var(--kb)-48px))] overflow-y-auto overscroll-contain",
              "surface-popover rounded-t-float px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] text-foreground shadow-sheet outline-0",
              // 下端に SheetFooter があるときは、下の余白と safe-area は SheetFooter が持つ
              "has-[[data-slot=sheet-footer]]:pb-0",
              // スワイプの量に追従する。出入りは下から
              "translate-y-[var(--drawer-swipe-movement-y,0px)] transition-[translate] duration-300 ease-drawer",
              "data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full data-[ending-style]:duration-200 data-[swiping]:duration-0",
            ),
            className,
          )}
          {...props}
        >
          {/* つまみ。浮く面の箱の地（bg-box）だとライトで見えないので、muted の文字色を薄くして置く */}
          <div className="mx-auto mt-1 mb-2 h-1 w-10 rounded-pill bg-muted-foreground/40" aria-hidden />
          {children}
        </Drawer.Popup>
      </Drawer.Viewport>
    </Drawer.Portal>
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof Drawer.Title>) {
  return <Drawer.Title data-slot="sheet-title" className={cnState("mb-3 text-title font-semibold", className)} {...props} />;
}

// シートの末尾の操作の段。中身がスクロールしても下端に固定して、常に見えるようにする
// （シートは下へのスワイプで閉じるので、主の操作を探してスクロールさせない）。
// 並べ方: 右寄せ、主の操作（primary / destructive）を右端、補助（ソースへ）は左端に ghost。
// 地はシートと同じ浮く面（下の中身が透けない）。下の余白に safe-area を足す。SheetContent の直下に置く
export function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "surface-popover sticky bottom-0 z-1 -mx-4 mt-4 flex flex-wrap items-center justify-end gap-2 px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]",
        className,
      )}
      {...props}
    />
  );
}
