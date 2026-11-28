import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

// 空・読み込み中の見せ方は 1 つ: 中央に寄せた文（本文・muted）と、次の操作のボタン 1 つ（任意）。
//   description: 次に何をすればよいかの補足（caption。操作がこの画面に無いとき）
//   action: 次の操作。強さは secondary（同じ画面の段に主の操作 primary があるので、2 つ目の塗りにしない）
//   fill: 置かれた場所の中央（PDF の台の上など）。省略時は上から 32px 空けて置く
export function EmptyState({
  className,
  action,
  description,
  fill = false,
  children,
  ...props
}: Omit<ComponentProps<"div">, "children"> & { children: ReactNode; action?: ReactNode; description?: ReactNode; fill?: boolean }) {
  return (
    <div
      data-slot="empty-state"
      role="status"
      className={cn(
        "flex flex-col items-center gap-4 px-4 text-center text-body text-muted-foreground wrap-anywhere",
        fill ? "absolute inset-0 justify-center" : "py-8",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <p>{children}</p>
        {description && <p className="text-caption">{description}</p>}
      </div>
      {action}
    </div>
  );
}
