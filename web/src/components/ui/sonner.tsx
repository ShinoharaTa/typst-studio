import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// トースト（sonner）。浮く面（popover・角丸 float）。sonner の CSS は @layer の外にあるので、色は変数で渡し、線は消す。
// 置き場は --toast-top（styles/screen.css）: 編集画面ではヘッダとタブの段の下に出す（タブを覆わない）。
// 閉じる × は右端に置き、押せる範囲は 44px
export function Toaster(props: ToasterProps) {
  const top = "var(--toast-top)";
  return (
    <Sonner
      theme="system"
      offset={{ top }}
      mobileOffset={{ top, left: "12px", right: "12px" }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "transparent",
          "--border-radius": "var(--radius-float)",
          fontFamily: "inherit",
        } as CSSProperties
      }
      toastOptions={{
        style: { boxShadow: "var(--elev-float)" },
        classNames: {
          toast: "surface-popover pr-11! text-body!",
          title: "font-normal!",
          description: "text-caption! text-muted-foreground!",
          closeButton:
            "left-auto! right-0! top-1/2! size-11! transform-none! -translate-y-1/2! rounded-pill! border-0! bg-transparent! text-muted-foreground! hover:bg-box! [&_svg]:size-4",
          error: "[&_[data-icon]]:text-destructive",
          success: "[&_[data-icon]]:text-success",
          warning: "[&_[data-icon]]:text-warning",
          info: "[&_[data-icon]]:text-primary",
        },
      }}
      {...props}
    />
  );
}
