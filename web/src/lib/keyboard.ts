// ソフトキーボードが出ているかの判定。
//   iOS: 表示領域（innerHeight）は縮まず visualViewport だけが縮むので、その差で分かる（--kb にも使う）
//   Android（interactive-widget=resizes-content）: innerHeight ごと縮むので差は 0 のまま。
//     幅ごとに「これまでに見た高さの最大」を覚え、それより大きく縮んでいればキーボードとみなす
//   どちらも、編集できる要素（CodeMirror・input・textarea）にフォーカスがあるときだけキーボードとみなす。
//   分割画面・PC のウィンドウ・DevTools で高さだけが縮んでも、フォーカスが無ければ付けない

export const IOS_INSET_PX = 80;
export const SHRINK_PX = 120;
// 画面の高さ（screen.availHeight）から引く、アドレスバーなどブラウザの UI の分の見込み
export const BROWSER_UI_PX = 100;

export interface ViewportSample {
  width: number;
  // visualViewport.height
  height: number;
  // innerHeight - (vv.height + vv.offsetTop)
  inset: number;
  // 編集できる要素にフォーカスがある
  editing: boolean;
  // 幅が変わった（回転・折りたたみ）ときに、キーボードが出たままでも最大を見積もるための値
  innerHeight?: number;
  screenHeight?: number;
}

export class KeyboardDetector {
  private width = -1;
  private maxHeight = 0;

  update(s: ViewportSample): boolean {
    if (s.width !== this.width) {
      // 回転・折りたたみで幅が変わった。覚えた最大は捨て、今の innerHeight と画面の高さから見積もり直す
      // （キーボードを出したまま回転しても、閉じるまで待たずに分かるように）
      this.width = s.width;
      this.maxHeight = Math.max(s.innerHeight ?? 0, s.screenHeight ? s.screenHeight - BROWSER_UI_PX : 0);
    }
    // キーボードが出ていないと分かっているとき（フォーカスが無い）の高さを最大に入れる
    if (!s.editing || s.inset <= IOS_INSET_PX) this.maxHeight = Math.max(this.maxHeight, s.height + Math.max(0, s.inset));
    if (!s.editing) return false;
    return s.inset > IOS_INSET_PX || this.maxHeight - s.height >= SHRINK_PX;
  }
}

// フォーカスを受けて文字を打てる要素か
export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    const nonText = ["button", "checkbox", "radio", "range", "file", "submit", "reset", "color", "image", "hidden"];
    return !nonText.includes(el.type) && !el.readOnly && !el.disabled;
  }
  return (el as HTMLElement).isContentEditable === true || el.getAttribute("contenteditable") === "true";
}
