import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// トースト（sonner）。sonner の CSS は @layer の外にあるので、色は変数で渡し、線は消す
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "transparent",
          "--border-radius": "var(--radius-box)",
          fontFamily: "inherit",
        } as CSSProperties
      }
      toastOptions={{
        style: { boxShadow: "var(--elev-float)" },
        classNames: { closeButton: "border-0! bg-secondary! text-foreground!" },
      }}
      {...props}
    />
  );
}
