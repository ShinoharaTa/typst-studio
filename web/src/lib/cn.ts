import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// styles.css の @theme で足した文字の大きさ・角丸・影を、tailwind-merge にも同じ組として教える
// （教えないと text-caption と text-body を別の組とみなし、両方を残してしまう）
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "body", "title", "screen", "input"],
      radius: ["box", "panel", "float", "pill"],
      shadow: ["float", "sheet", "dialog"],
      ease: ["out", "drawer"],
    },
  },
});

// shadcn/ui の cn（クラスをつなぎ、Tailwind の同じ性質は後に書いたものを残す）
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Base UI の部品の className（文字列か、状態を受け取る関数）に、部品の側のクラスを足す
export function cnState<S>(base: string, className: string | ((state: S) => string | undefined) | undefined) {
  if (typeof className !== "function") return cn(base, className);
  return (state: S) => cn(base, className(state));
}
