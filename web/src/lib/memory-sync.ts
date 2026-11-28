import { Debouncer, LatestOnly } from "./schedule";

// 未保存の内容を記事プレビュー（tinymist のメモリファイル）へ流す（1 ファイル分）。
//   入力 300ms 後に送る。送信は 1 本ずつで、直前の送信が終わってから最後の値だけを送る
//   （set と reset が入れ替わって、古い内容がプレビューに残らないようにする）

export const MEMORY_MS = 300;

export interface MemoryIO {
  set(content: string): Promise<unknown>;
  reset(): Promise<unknown>;
  // プレビューがこのプロジェクトで動いている
  canSend(): boolean;
}

type Op = { kind: "set"; content: string } | { kind: "reset" };

export class MemorySync {
  private q: LatestOnly<Op>;
  private debouncer: Debouncer;
  private text: () => string = () => "";
  // メモリに何かを送った（reset が要る）
  private dirty = false;

  constructor(
    private readonly io: MemoryIO,
    ms = MEMORY_MS,
  ) {
    this.q = new LatestOnly<Op>(async (op) => {
      if (!this.io.canSend()) return;
      if (op.kind === "set") await this.io.set(op.content);
      else await this.io.reset();
    });
    this.debouncer = new Debouncer(ms, () => {
      this.dirty = true;
      this.q.push({ kind: "set", content: this.text() });
    });
  }

  // エディタの内容が変わった
  changed(text: () => string): void {
    this.text = text;
    this.debouncer.schedule();
  }

  // 保存が済んだ・切り替える。メモリの内容を捨ててディスクの内容に戻す
  reset(): void {
    this.debouncer.cancel();
    if (!this.dirty) return;
    this.dirty = false;
    this.q.push({ kind: "reset" });
  }

  // 待っている送信を今すぐ確定させる（捨てない）
  flush(): void {
    this.debouncer.flush();
  }

  settled(): Promise<void> {
    return this.q.settled();
  }
}
