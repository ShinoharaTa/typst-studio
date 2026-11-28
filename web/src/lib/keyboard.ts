// ソフトキーボードが出ているかの判定。
//   iOS: 表示領域（innerHeight）は縮まず visualViewport だけが縮むので、その差で分かる（--kb にも使う）
//   Android（interactive-widget=resizes-content）: innerHeight ごと縮むので差は 0 のまま。
//     幅ごとに「これまでに見た visualViewport の高さの最大」を覚え、それより大きく縮んでいればキーボードとみなす

export const IOS_INSET_PX = 80;
export const SHRINK_PX = 120;

export class KeyboardDetector {
  private width = -1;
  private maxHeight = 0;

  // inset: innerHeight - (vv.height + vv.offsetTop)
  update(width: number, height: number, inset: number): boolean {
    // 回転・折りたたみで幅が変わったら、覚えた最大は捨てる
    if (width !== this.width) {
      this.width = width;
      this.maxHeight = 0;
    }
    this.maxHeight = Math.max(this.maxHeight, height + Math.max(0, inset));
    return inset > IOS_INSET_PX || this.maxHeight - height >= SHRINK_PX;
  }
}
