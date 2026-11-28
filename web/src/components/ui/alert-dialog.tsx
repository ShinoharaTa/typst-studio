import { AlertDialog as Base } from "@base-ui/react/alert-dialog";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// 確認のダイアログ（Base UI の AlertDialog に見た目を付けたもの）
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
        className={cn(
          "fixed top-1/2 left-1/2 z-31 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2",
          "rounded-panel bg-card p-5 text-foreground shadow-dialog",
          "transition-[opacity,scale] duration-200 ease-out",
          "data-[ending-style]:scale-96 data-[ending-style]:opacity-0 data-[starting-style]:scale-96 data-[starting-style]:opacity-0",
          className as string,
        )}
        {...props}
      >
        {children}
      </Base.Popup>
    </Base.Portal>
  );
}

export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof Base.Title>) {
  return <Base.Title data-slot="alert-dialog-title" className={cn("mb-2 text-md font-bold", className as string)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: ComponentProps<typeof Base.Description>) {
  return (
    <Base.Description
      data-slot="alert-dialog-description"
      className={cn("mb-4 text-muted-foreground wrap-anywhere", className as string)}
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-dialog-footer" className={cn("flex flex-wrap justify-end gap-2", className)} {...props} />;
}
