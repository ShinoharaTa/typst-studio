import type { SyntheticEvent } from "react";

// ソフトキーボード表示中も見えるツールバー（spec 4.2）。押してもエディタのフォーカスを外さない。
// Android の Chrome は pointerdown を止めても、後から合成する mousedown でフォーカスを移すことがあるので両方止める
const keep = (e: SyntheticEvent) => e.preventDefault();
export const TOOLBAR_CHARS = ["#", "[", "]", "(", ")", '"'];

export function EditToolbar(props: {
  onSave(): void;
  onUndo(): void;
  onInsert(ch: string): void;
  saveDisabled: boolean;
  // 画像シートを開いている間など、エディタが読み取り専用
  disabled?: boolean;
}) {
  const hold = { onPointerDown: keep, onMouseDown: keep };
  // 保存済みでも disabled にはしない（disabled のボタンは押したときにフォーカスを奪う）。aria-disabled で示す
  const saveOff = props.saveDisabled || props.disabled === true;
  return (
    <div className="edit-toolbar" role="toolbar" aria-label="入力補助" data-locked={props.disabled === true}>
      <button type="button" className="tb-btn tb-save" {...hold} onClick={() => !saveOff && props.onSave()} aria-disabled={saveOff}>
        保存
      </button>
      <button type="button" className="tb-btn" {...hold} onClick={props.onUndo} aria-label="元に戻す" disabled={props.disabled}>
        ↶
      </button>
      <span className="tb-gap" aria-hidden />
      {TOOLBAR_CHARS.map((c) => (
        <button key={c} type="button" className="tb-btn tb-char" {...hold} onClick={() => props.onInsert(c)} disabled={props.disabled}>
          {c}
        </button>
      ))}
    </div>
  );
}
