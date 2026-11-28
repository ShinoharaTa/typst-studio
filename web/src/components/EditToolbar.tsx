import type { PointerEvent } from "react";

// ソフトキーボード表示中も見えるツールバー（spec 4.2）。押してもエディタのフォーカスを外さない
const keep = (e: PointerEvent) => e.preventDefault();
const CHARS = ["#", "[", "]", "(", ")", '"'];

export function EditToolbar(props: {
  onSave(): void;
  onUndo(): void;
  onInsert(ch: string): void;
  saveDisabled: boolean;
  // 画像シートを開いている間など、エディタが読み取り専用
  disabled?: boolean;
}) {
  return (
    <div className="edit-toolbar" role="toolbar" aria-label="入力補助">
      <button type="button" className="tb-btn tb-save" onPointerDown={keep} onClick={props.onSave} disabled={props.saveDisabled || props.disabled}>
        保存
      </button>
      <button type="button" className="tb-btn" onPointerDown={keep} onClick={props.onUndo} aria-label="元に戻す" disabled={props.disabled}>
        ↶
      </button>
      <span className="tb-gap" aria-hidden />
      {CHARS.map((c) => (
        <button key={c} type="button" className="tb-btn tb-char" onPointerDown={keep} onClick={() => props.onInsert(c)} disabled={props.disabled}>
          {c}
        </button>
      ))}
    </div>
  );
}
