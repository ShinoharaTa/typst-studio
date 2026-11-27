import { ConflictError } from "../api/client";
import { Debouncer } from "./schedule";

// 開いているファイル 1 つの保存の状態（spec 4.3 / 6.4）
//   明示保存 + 入力停止 2 秒の自動保存。保存は開いたときの rev を添える楽観ロック

export type SaveState = "clean" | "dirty" | "saving" | "conflict" | "error";

export interface DocSnapshot {
  state: SaveState;
  // ディスク側が変わった（未保存の編集があるので読み込み直していない）
  diskChanged: boolean;
  error?: string;
  conflict?: { rev: string; content: string };
}

export interface DocIO {
  read(): Promise<{ content: string; rev: string }>;
  write(content: string, baseRev: string | null): Promise<{ rev: string }>;
}

export const AUTOSAVE_MS = 2000;

export class DocSession {
  rev: string | null = null;
  // ディスクにある（と分かっている）内容
  saved = "";
  private snap: DocSnapshot = { state: "clean", diskChanged: false };
  private autosave: Debouncer;
  private saving?: Promise<void>;
  private again = false;
  // 保存中に届いた外部の変更の rev
  private externalWhileSaving?: string;
  private disposed = false;
  // 読み込みが済むまでは、エディタの内容（前のファイルのまま・空）を保存しない
  loaded = false;

  constructor(
    private readonly io: DocIO,
    // エディタの今の内容
    private current: () => string,
    private readonly onChange: (s: DocSnapshot) => void,
    // ディスクの内容に置き換えてよいとき（未編集で外部の変更が来た）
    private readonly onExternalReload: (content: string) => void,
    autosaveMs = AUTOSAVE_MS,
  ) {
    this.autosave = new Debouncer(autosaveMs, () => void this.save());
  }

  get snapshot(): DocSnapshot {
    return this.snap;
  }

  get dirty(): boolean {
    return this.current() !== this.saved;
  }

  private set(p: Partial<DocSnapshot>): void {
    if (this.disposed) return;
    this.snap = { ...this.snap, ...p };
    this.onChange(this.snap);
  }

  async load(): Promise<string> {
    const f = await this.io.read();
    this.rev = f.rev;
    this.saved = f.content;
    this.loaded = true;
    this.set({ state: "clean", diskChanged: false, error: undefined, conflict: undefined });
    return f.content;
  }

  // エディタの内容が変わった
  edited(): void {
    if (!this.loaded) return;
    if (this.snap.state === "conflict" || this.snap.state === "saving") return;
    if (this.dirty) {
      this.set({ state: "dirty" });
      this.autosave.schedule();
    } else {
      this.autosave.cancel();
      if (this.snap.state !== "error") this.set({ state: "clean" });
    }
  }

  save(): Promise<void> {
    this.autosave.cancel();
    if (this.saving) {
      this.again = true;
      return this.saving;
    }
    if (!this.loaded || this.snap.state === "conflict" || !this.dirty) return Promise.resolve();
    this.saving = this.doSave().finally(() => {
      this.saving = undefined;
    });
    return this.saving;
  }

  private async doSave(): Promise<void> {
    do {
      this.again = false;
      const content = this.current();
      if (content === this.saved) break;
      this.set({ state: "saving" });
      try {
        const { rev } = await this.io.write(content, this.rev);
        this.rev = rev;
        this.saved = content;
        this.set({ state: this.dirty ? "dirty" : "clean", error: undefined });
      } catch (e) {
        if (e instanceof ConflictError) {
          this.again = false;
          this.set({ state: "conflict", conflict: { rev: e.rev, content: e.content } });
          return;
        }
        this.again = false;
        this.set({ state: "error", error: (e as Error).message });
        return;
      }
    } while (this.again);
    const ext = this.externalWhileSaving;
    this.externalWhileSaving = undefined;
    if (ext !== undefined) await this.external(ext);
    else if (this.dirty) this.autosave.schedule();
  }

  // 衝突: ディスクの内容で読み込み直す（手元の編集は捨てる）
  resolveReload(): string {
    const c = this.snap.conflict;
    if (!c) return this.current();
    this.rev = c.rev;
    this.saved = c.content;
    this.set({ state: "clean", conflict: undefined, diskChanged: false });
    return c.content;
  }

  // 衝突: 手元の内容で上書きする
  resolveOverwrite(): Promise<void> {
    const c = this.snap.conflict;
    if (!c) return Promise.resolve();
    this.rev = c.rev;
    this.saved = c.content;
    this.set({ state: this.dirty ? "dirty" : "clean", conflict: undefined, diskChanged: false });
    return this.save();
  }

  // ディスクのファイルが変わった（/api/ws の file-changed）
  async external(rev: string): Promise<void> {
    if (!this.loaded || rev === this.rev) return;
    if (this.saving) {
      this.externalWhileSaving = rev;
      return;
    }
    if (this.snap.state === "conflict") return;
    if (this.dirty) {
      // 次の保存で衝突として扱う
      this.set({ diskChanged: true });
      return;
    }
    const before = this.current();
    const f = await this.io.read();
    if (this.disposed) return;
    // 読んでいる間に入力があった。rev は古いままにして、次の保存で衝突として扱う
    if (this.current() !== before) {
      this.set({ diskChanged: true });
      return;
    }
    this.rev = f.rev;
    this.saved = f.content;
    this.set({ state: "clean", diskChanged: false, error: undefined });
    this.onExternalReload(f.content);
  }

  // 待っている自動保存を今すぐ行う
  flush(): Promise<void> {
    if (!this.loaded) return Promise.resolve();
    if (this.autosave.pending || this.dirty) return this.save();
    return this.saving ?? Promise.resolve();
  }

  // 以後の状態通知を止める。エディタが別のファイルに切り替わっても、保存中・保存待ちの分は
  // 閉じた時点の内容で書く
  dispose(): void {
    this.autosave.cancel();
    const last = this.current();
    this.current = () => last;
    this.disposed = true;
  }
}
