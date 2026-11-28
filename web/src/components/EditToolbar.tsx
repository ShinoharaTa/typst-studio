import type { SyntheticEvent } from "react";

// ソフトキーボード表示中も見えるツールバー（spec 4.2）。押してもエディタのフォーカスを外さない。
// Android の Chrome は pointerdown を止めても、後から合成する mousedown でフォーカスを移すことがあるので両方止める
const keep = (e: SyntheticEvent) => e.preventDefault();
export const TOOLBAR_CHARS = ["#", "[", "]", "(", ")", '"'];
type SaveState = "clean" | "dirty" | "saving" | "conflict" | "error";
// 「保存」は保存の状態も示す（ヘッダの状態と画面の上下に分かれないように）。幅を変えないよう 3 文字まで
const SAVE_TEXT: Record<SaveState, string> = { clean: "保存済", dirty: "保存", saving: "保存中", conflict: "衝突", error: "再試行" };

export function EditToolbar(props: {
  onSave(): void;
  onUndo(): void;
  onInsert(ch: string): void;
  saveDisabled: boolean;
  // 省略時は saveDisabled から（保存済み / 未保存）
  saveState?: SaveState;
  // 画像シートを開いている間など、エディタが読み取り専用
  disabled?: boolean;
}) {
  const hold = { onPointerDown: keep, onMouseDown: keep };
  // 保存済みでも disabled にはしない（disabled のボタンは押したときにフォーカスを奪う）。aria-disabled で示す
  const saveOff = props.saveDisabled || props.disabled === true;
  const state = props.saveState ?? (props.saveDisabled ? "clean" : "dirty");
  return (
    <div className="edit-toolbar" role="toolbar" aria-label="入力補助" data-locked={props.disabled === true}>
      <button
        type="button"
        className="tb-btn tb-save"
        data-state={state}
        {...hold}
        onClick={() => !saveOff && props.onSave()}
        aria-disabled={saveOff}
        aria-label={state === "error" ? "保存できませんでした。もう一度保存する" : undefined}
      >
        {SAVE_TEXT[state]}
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
