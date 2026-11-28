import { AlertDialog as Base } from "@base-ui/react/alert-dialog";
import type { ComponentProps } from "react";
import { cn, cnState } from "../../lib/cn";

// 確認のダイアログ（Base UI の AlertDialog に見た目を付けたもの）。浮く面（popover・角丸 float）
export const AlertDialog = Base.Root;

export function AlertDialogContent({ className, children, ...props }: ComponentProps<typeof Base.Popup>) {
  return (
    <Base.Portal>
      <Base.Backdrop
        data-slot="alert-dialog-backdrop"
        className="fixed inset-0 z-30 bg-scrim transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
      />
      <Base.Popup
        data-slot="alert-dialog"
        className={cnState(
          cn(
            "fixed top-1/2 left-1/2 z-31 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2",
            "surface-popover rounded-float p-6 text-foreground shadow-dialog outline-0",
            "transition-[opacity,scale] duration-200 ease-out",
            "data-[ending-style]:scale-96 data-[ending-style]:opacity-0 data-[starting-style]:scale-96 data-[starting-style]:opacity-0",
          ),
          className,
        )}
        {...props}
      >
        {children}
      </Base.Popup>
    </Base.Portal>
  );
}

export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof Base.Title>) {
  return <Base.Title data-slot="alert-dialog-title" className={cnState("mb-2 text-title font-semibold", className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: ComponentProps<typeof Base.Description>) {
  return <Base.Description data-slot="alert-dialog-description" className={cnState("mb-6 text-muted-foreground wrap-anywhere", className)} {...props} />;
}

// 操作は右寄せ。主の操作（primary / destructive）を右端に置く。幅が足りず折り返したら、各行を全幅にする
export function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-dialog-footer" className={cn("flex flex-wrap justify-end gap-2 [&>*]:grow", className)} {...props} />;
}
