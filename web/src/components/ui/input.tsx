import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

// 入力欄。枠線は使わず、置かれた面の箱の地で示す（bg-box）。文字は 16px（iOS の拡大を避ける）。
// 例や補足は placeholder に書かず、欄の下の FieldDescription に書く（入力済みの値に見えないように）。
// 不正な値は線ではなく outline（文言は FieldError で別に出す）
const field = "min-h-11 rounded-box bg-box px-3 text-input text-foreground";
const invalid =
  "aria-invalid:outline-2 aria-invalid:outline-offset-0 aria-invalid:outline-destructive invalid:outline-2 invalid:outline-offset-0 invalid:outline-destructive";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return <input data-slot="input" type={type} className={cn(field, "w-full", invalid, className)} {...props} />;
}

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select data-slot="select" className={cn(field, "min-w-0 max-w-full", className)} {...props} />;
}

// チェックボックス（OS の部品のまま。色だけ primary）
export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return <input data-slot="checkbox" type="checkbox" className={cn("m-0 size-5 accent-primary", className)} {...props} />;
}

// スライダーは横に動かすので、縦のスクロールだけ許す
export function Slider({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return <input data-slot="slider" type="range" className={cn("h-11 min-w-0 flex-1 touch-pan-y accent-primary", className)} {...props} />;
}

// チェックボックスなどの横のラベル（caption。押せる範囲は 44px）
export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label data-slot="label" className={cn("inline-flex min-h-11 items-center gap-2 text-caption", className)} {...props} />;
}

// ラベル + 入力の組（fieldset でも使う）
export function Field({ className, ...props }: ComponentProps<"label">) {
  return <label data-slot="field" className={cn("flex min-w-0 flex-col gap-2", className)} {...props} />;
}

export function FieldSet({ className, ...props }: ComponentProps<"fieldset">) {
  return <fieldset data-slot="field" className={cn("flex min-w-0 flex-col gap-2", className)} {...props} />;
}

export function FieldLabel({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="field-label" className={cn("text-caption text-muted-foreground", className)} {...props} />;
}

export function FieldLegend({ className, ...props }: ComponentProps<"legend">) {
  return <legend data-slot="field-label" className={cn("mb-2 text-caption text-muted-foreground", className)} {...props} />;
}

// 欄の補足（例・単位の換算など）
export function FieldDescription({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="field-description" className={cn("text-caption text-muted-foreground", className)} {...props} />;
}

export function FieldError({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="field-error" className={cn("text-caption text-destructive", className)} {...props} />;
}
