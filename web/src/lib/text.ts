// 行頭からコードポイント n 個分の UTF-16 の長さ
export function codePointsToUtf16(text: string, n: number): number {
  let i = 0;
  for (let k = 0; k < n && i < text.length; k++) {
    const c = text.codePointAt(i)!;
    i += c > 0xffff ? 2 : 1;
  }
  return i;
}
