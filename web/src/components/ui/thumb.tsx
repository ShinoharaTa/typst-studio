import { ImageOff } from "lucide-react";
import { cn } from "../../lib/cn";

// 画像のサムネイル（一覧の行・シートの見出し）。地は置かれた面が決める。読めない画像はアイコン
export function Thumb({ src, size = "md" }: { src: string | null; size?: "md" | "lg" }) {
  const box = cn("flex-none rounded-box bg-box", size === "lg" ? "size-16" : "size-12");
  return src ? (
    <img data-slot="thumb" className={cn(box, "object-contain")} src={src} alt="" loading="lazy" />
  ) : (
    <span data-slot="thumb" className={cn(box, "flex items-center justify-center text-muted-foreground [&_svg]:size-5")}>
      <ImageOff aria-label="画像を読めません" />
    </span>
  );
}
