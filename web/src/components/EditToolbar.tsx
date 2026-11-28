import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { Toolbar, ToolbarGap, ToolbarKey } from "./ui/toolbar";

// ソフトキーボード表示中も見えるツールバー（spec 4.2）。押してもエディタのフォーカスを外さない。
// Android の Chrome は pointerdown を止めても、後から合成する mousedown でフォーカスを移すことがあるので両方止める
const keep = (e: SyntheticEvent) => e.preventDefault();
export const TOOLBAR_CHARS = ["#", "[", "]", "(", ")", '"'];
type SaveState = "clean" | "dirty" | "saving" | "conflict" | "error";
// 「保存」は保存の状態も示す（ヘッダの状態と画面の上下に分かれないように）。幅を変えないよう 3 文字まで
const SAVE_TEXT: Record<SaveState, string> = { clean: "保存済", dirty: "保存", saving: "保存中", conflict: "衝突", error: "再試行" };
// 「保存中」は、保存がこれより長く掛かったときだけ出す（すぐ終わる保存で 3 つの文言が続けて入れ替わらないように）
export const SAVING_SHOW_MS = 400;
// 出した「保存中」は、保存が先に終わってもこの間は保つ（一瞬だけ出て消えないように）
export const SAVING_MIN_MS = 500;

// saving に入ってから SAVING_SHOW_MS の間は、その前の状態のまま見せる。出した後は SAVING_MIN_MS まで保つ
function useShownState(state: SaveState): SaveState {
  const before = useRef<SaveState>(state === "saving" ? "dirty" : state);
  const [slow, setSlow] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (state === "saving") {
      if (slow) return;
      const t = setTimeout(() => {
        since.current = Date.now();
        setSlow(true);
      }, SAVING_SHOW_MS);
      return () => clearTimeout(t);
    }
    before.current = state;
    if (!slow) return;
    const left = since.current + SAVING_MIN_MS - Date.now();
    if (left <= 0) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(false), left);
    return () => clearTimeout(t);
  }, [state, slow]);
  return slow ? "saving" : state === "saving" ? before.current : state;
}

// 「保存」は保存の状態を文言と色で示す。文言が変わってもキーの並びがずれないよう幅を固定する。
// 文字の拡大で折れて切れないよう px で指定し、折り返さない（エディタの本文・行番号と同じ扱い）。
// 太さは全状態で同じにする（文言が変わるたびに字の形が揺れないように）。
// 未保存は自動保存（2 秒）で消えるので、塗りの primary で呼びかけず、記号キーと同じ強さの accent の地にする。
// 画像シートを開いている間（エディタが読み取り専用）は、ほかのキーと同じく薄くする
export const SAVE_CLASS = [
  "tb-save w-14 px-0 text-[14px] font-semibold whitespace-nowrap bg-transparent text-muted-foreground",
  "data-[state=dirty]:bg-accent data-[state=dirty]:text-primary",
  "data-[state=conflict]:bg-destructive-soft data-[state=conflict]:text-destructive",
  "data-[state=error]:bg-destructive-soft data-[state=error]:text-destructive",
  "in-data-[locked=true]:opacity-50",
].join(" ");

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
  const actual = props.saveState ?? (props.saveDisabled ? "clean" : "dirty");
  const state = useShownState(actual);
  // 見た目が実際の状態とずれている間（「保存中」を出す前・保ちの間）は、見た目に合わせる
  const saveOff =
    props.disabled === true || (state === actual ? props.saveDisabled : state === "clean" || state === "saving" || state === "conflict");
  return (
    <Toolbar className="edit-toolbar" aria-label="入力補助" data-locked={props.disabled === true}>
      <ToolbarKey
        className={SAVE_CLASS}
        data-state={state}
        {...hold}
        onClick={() => !saveOff && props.onSave()}
        aria-disabled={saveOff}
        aria-label={state === "error" ? "保存できませんでした。もう一度保存する" : undefined}
      >
        {SAVE_TEXT[state]}
      </ToolbarKey>
      <ToolbarKey {...hold} onClick={props.onUndo} aria-label="元に戻す" disabled={props.disabled}>
        ↶
      </ToolbarKey>
      <ToolbarGap />
      {TOOLBAR_CHARS.map((c) => (
        // 記号キーは残りの幅を分け合う（320px でも右端の " まで収める。広い画面では幅いっぱいに伸ばし、右を空けない）
        <ToolbarKey key={c} className="tb-char min-w-7 flex-1 px-0 font-mono" {...hold} onClick={() => props.onInsert(c)} disabled={props.disabled}>
          {c}
        </ToolbarKey>
      ))}
    </Toolbar>
  );
}
