import type { PointerEvent } from "react";

// ソフトキーボード表示中も見えるツールバー（spec 4.2）。押してもエディタのフォーカスを外さない
const keep = (e: PointerEvent) => e.preventDefault();
const CHARS = ["#", "[", "]", "(", ")", '"'];

export function EditToolbar(props: { onSave(): void; onUndo(): void; onInsert(ch: string): void; saveDisabled: boolean }) {
  return (
    <div className="edit-toolbar" role="toolbar" aria-label="入力補助">
      <button type="button" className="tb-btn tb-save" onPointerDown={keep} onClick={props.onSave} disabled={props.saveDisabled}>
        保存
      </button>
      <button type="button" className="tb-btn" onPointerDown={keep} onClick={props.onUndo} aria-label="元に戻す">
        ↶
      </button>
      <span className="tb-sep" />
      {CHARS.map((c) => (
        <button key={c} type="button" className="tb-btn tb-char" onPointerDown={keep} onClick={() => props.onInsert(c)}>
          {c}
        </button>
      ))}
    </div>
  );
}
