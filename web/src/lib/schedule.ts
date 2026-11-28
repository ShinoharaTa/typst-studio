// 入力のデバウンスと、非同期処理の間引き

export class Debouncer {
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly ms: number,
    private readonly fn: () => void,
  ) {}

  get pending(): boolean {
    return this.timer !== undefined;
  }

  schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fn();
    }, this.ms);
  }

  // 待ちがあれば今すぐ実行する
  flush(): void {
    if (!this.pending) return;
    this.cancel();
    this.fn();
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

// 同時に 1 本だけ走らせ、走っている間に来た呼び出しは最後の 1 つだけ後で走らせる
// （スライダーの追従など、途中の値は捨ててよいもの）
export class LatestOnly<T> {
  private running = false;
  private next?: { value: T };
  private idle: Promise<void> = Promise.resolve();
  private resolveIdle?: () => void;

  constructor(private readonly fn: (value: T) => Promise<unknown>) {}

  push(value: T): void {
    this.next = { value };
    if (!this.running) void this.drain();
  }

  // 待ちと実行中のものが終わるまで待つ
  settled(): Promise<void> {
    return this.idle;
  }

  // 待ちを捨てる（実行中のものは止めない）
  clear(): void {
    this.next = undefined;
  }

  private async drain(): Promise<void> {
    this.running = true;
    this.idle = new Promise((r) => (this.resolveIdle = r));
    try {
      while (this.next) {
        const { value } = this.next;
        this.next = undefined;
        try {
          await this.fn(value);
        } catch {
          // 呼び出し側の fn で扱う。ここでは次へ進む
        }
      }
    } finally {
      this.running = false;
      this.resolveIdle?.();
    }
  }
}

// 本のビルドに効くファイル（.typ と画像）
export function isBuildInput(path: string): boolean {
  return /\.(typ|png|jpe?g|webp|svg|gif)$/i.test(path);
}

// 「本」タブ表示中だけ、ファイルの変更から delay 後にビルドする（spec 3.3.4）
export class AutoBuild {
  private readonly debouncer: Debouncer;
  private active = false;

  constructor(trigger: () => void, delayMs = 5000) {
    this.debouncer = new Debouncer(delayMs, trigger);
  }

  get pending(): boolean {
    return this.debouncer.pending;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.debouncer.cancel();
  }

  // ファイルが変わった（保存された）
  notify(): void {
    if (this.active) this.debouncer.schedule();
  }

  dispose(): void {
    this.setActive(false);
  }
}
