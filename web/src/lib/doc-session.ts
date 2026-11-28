import { ConflictError } from "../api/client";
import { Debouncer } from "./schedule";

// 開いているファイル 1 つの保存の状態（spec 4.3 / 6.4）
//   明示保存 + 入力停止 2 秒の自動保存。保存は開いたときの rev を添える楽観ロック。
//   最後の内容はセッションが持つ（エディタが先に破棄されても、閉じた時点の内容で保存できる）

export type SaveState = "clean" | "dirty" | "saving" | "conflict" | "error";

export interface DocSnapshot {
  state: SaveState;
  // ディスク側が変わった（未保存の編集があるので読み込み直していない）
  diskChanged: boolean;
  // ディスク上で削除された（file-removed）
  removed: boolean;
  error?: string;
  // rev が null: ファイルが無くなった。content が null: ディスクの内容を読めない（2MB 超・UTF-8 でない）
  conflict?: { rev: string | null; content: string | null };
}

// CodeMirror の Text など。必要になるまで文字列にしない
export interface DocText {
  toString(): string;
}

export interface WriteOptions {
  // 裏に回るとき（ページが閉じられても送り切る）
  keepalive?: boolean;
}

export interface DocIO {
  read(): Promise<{ content: string; rev: string }>;
  write(content: string, baseRev: string | null, opts?: WriteOptions): Promise<{ rev: string }>;
}

export const AUTOSAVE_MS = 2000;
// 自分の保存で付いた rev を覚えておく数（遅れて届く自分の通知を外部の変更と取り違えない）
const OWN_REVS = 16;

export class DocSession {
  rev: string | null = null;
  // ディスクにある（と分かっている）内容。null は分からない（常に未保存扱い）
  saved: string | null = "";
  // 読み込みが済むまでは保存しない
  loaded = false;
  private doc: DocText = "";
  private snap: DocSnapshot = { state: "clean", diskChanged: false, removed: false };
  private autosave: Debouncer;
  private saving?: Promise<void>;
  private again = false;
  private nextOpts: WriteOptions = {};
  // 保存中に届いた外部の変更の rev
  private externalWhileSaving?: string;
  private ownRevs: string[] = [];
  private disposed = false;
  private saveGen = 0;

  constructor(
    private readonly io: DocIO,
    private readonly onChange: (s: DocSnapshot) => void,
    // ディスクの内容に置き換えてよいとき（未編集で外部の変更が来た）
    private readonly onExternalReload: (content: string) => void,
    private readonly opts: { autosaveMs?: number; onSaved?: (clean: boolean) => void } = {},
  ) {
    this.autosave = new Debouncer(opts.autosaveMs ?? AUTOSAVE_MS, () => void this.save());
  }

  get snapshot(): DocSnapshot {
    return this.snap;
  }

  // 手元の最新の内容
  get text(): string {
    return this.doc.toString();
  }

  get dirty(): boolean {
    return this.loaded && this.text !== this.saved;
  }

  // 未保存の編集が無く、保存の失敗も衝突も残っていない
  get safe(): boolean {
    return !this.loaded || (!this.dirty && this.snap.state !== "conflict" && this.snap.state !== "error");
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
    this.doc = f.content;
    this.loaded = true;
    this.set({ state: "clean", diskChanged: false, removed: false, error: undefined, conflict: undefined });
    return f.content;
  }

  // エディタの内容が変わった
  edited(doc: DocText): void {
    if (!this.loaded) return;
    this.doc = doc;
    // 保存中・衝突中は状態を変えない（保存が終わったら見直す）
    if (this.snap.state === "conflict" || this.snap.state === "saving") return;
    if (this.dirty) {
      this.set({ state: "dirty" });
      this.autosave.schedule();
    } else {
      // ディスクと同じ内容に戻った（元に戻すなど）。保存の失敗も残っていない
      this.autosave.cancel();
      this.set({ state: "clean", error: undefined });
    }
  }

  // 保存して、safe かどうかを返す
  async save(opts: WriteOptions = {}): Promise<boolean> {
    this.autosave.cancel();
    if (this.saving) {
      this.again = true;
      this.nextOpts = opts;
      await this.saving;
      return this.safe;
    }
    if (!this.loaded || this.snap.state === "conflict") return this.safe;
    if (!this.dirty) {
      if (this.snap.state === "error") this.set({ state: "clean", error: undefined });
      return this.safe;
    }
    // 先の保存の後始末が、次の保存の saving を消さないように世代で見分ける
    const gen = ++this.saveGen;
    const p = this.doSave(opts).finally(() => {
      if (this.saveGen === gen) this.saving = undefined;
    });
    this.saving = p;
    await p;
    return this.safe;
  }

  private async doSave(first: WriteOptions): Promise<void> {
    let opts = first;
    let wrote = false;
    do {
      this.again = false;
      const content = this.text;
      if (content === this.saved) break;
      this.set({ state: "saving" });
      try {
        const { rev } = await this.io.write(content, this.rev, opts);
        this.rev = rev;
        this.saved = content;
        this.ownRevs.push(rev);
        if (this.ownRevs.length > OWN_REVS) this.ownRevs.shift();
        wrote = true;
        this.set({ state: this.dirty ? "dirty" : "clean", error: undefined, diskChanged: false, removed: false });
      } catch (e) {
        this.again = false;
        if (e instanceof ConflictError) {
          this.set({ state: "conflict", conflict: { rev: e.rev, content: e.content } });
        } else {
          this.set({ state: "error", error: (e as Error).message });
        }
        return;
      }
      opts = this.nextOpts;
      this.nextOpts = {};
    } while (this.again);
    const ext = this.externalWhileSaving;
    this.externalWhileSaving = undefined;
    this.saving = undefined;
    if (ext !== undefined) await this.external(ext);
    if (this.dirty && this.snap.state !== "conflict") {
      this.set({ state: "dirty" });
      this.autosave.schedule();
    }
    if (wrote) this.opts.onSaved?.(!this.dirty);
  }

  // 衝突: ディスクの内容で読み込み直す（手元の編集は捨てる）。読み直せないときは null
  resolveReload(): string | null {
    const c = this.snap.conflict;
    if (!c || c.rev === null || c.content === null) return null;
    this.rev = c.rev;
    this.saved = c.content;
    this.doc = c.content;
    // 前の保存の失敗も、捨てた編集と一緒に消す（残すと、次に打ったときに失敗の表示が戻る）
    this.set({ state: "clean", conflict: undefined, diskChanged: false, removed: false, error: undefined });
    return c.content;
  }

  // 衝突: 読み込み直せないとき、手元の編集を捨てて保存しない（以後は読み取りだけ）
  discard(): void {
    if (!this.snap.conflict) return;
    this.saved = this.text;
    this.set({ state: "clean", conflict: undefined, error: undefined });
  }

  // 衝突: 手元の内容で上書きする（無くなっていれば作り直す）
  async resolveOverwrite(): Promise<boolean> {
    const c = this.snap.conflict;
    if (!c) return this.safe;
    this.rev = c.rev;
    this.saved = c.content;
    this.set({ state: this.dirty ? "dirty" : "clean", conflict: undefined, diskChanged: false });
    return this.save();
  }

  // ディスクのファイルが変わった（/api/ws の file-changed）。失敗しても投げない
  async external(rev: string): Promise<void> {
    if (!this.loaded || rev === this.rev || this.ownRevs.includes(rev)) return;
    if (this.saving) {
      this.externalWhileSaving = rev;
      return;
    }
    if (this.snap.state === "conflict") return;
    if (this.dirty) {
      // 次の保存で衝突として扱う
      this.set({ diskChanged: true, removed: false });
      return;
    }
    const before = this.text;
    let f: { content: string; rev: string };
    try {
      f = await this.io.read();
    } catch {
      return;
    }
    if (this.disposed) return;
    // 読んでいる間に入力があった。rev は古いままにして、次の保存で衝突として扱う
    if (this.text !== before) {
      this.set({ diskChanged: true, removed: false });
      return;
    }
    this.rev = f.rev;
    this.saved = f.content;
    this.doc = f.content;
    this.set({ state: "clean", diskChanged: false, removed: false, error: undefined });
    this.onExternalReload(f.content);
  }

  // ディスク上で削除された（file-removed）。次の保存で「無くなった」衝突になる
  removedOnDisk(): void {
    if (!this.loaded) return;
    this.set({ removed: true });
  }

  // 待っている自動保存を今すぐ行い、safe かどうかを返す
  async flush(opts: WriteOptions = {}): Promise<boolean> {
    if (!this.loaded) return true;
    if (this.saving || this.autosave.pending || this.dirty) return this.save(opts);
    return this.safe;
  }

  // 以後の状態通知と自動保存を止める（保存中・flush 中のものは閉じた時点の内容で書き切る）
  dispose(): void {
    this.autosave.cancel();
    this.disposed = true;
  }
}
