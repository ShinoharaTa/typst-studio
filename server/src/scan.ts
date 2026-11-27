// .typ の image( 呼び出しを抜き出すスキャナ（spec 4.4 の S1）。
// 構文木は作らず、マークアップ / コード / 数式のモードと、文字列・コメント（// と入れ子の /* */）・
// raw・括弧の入れ子・コンテンツブロック [] だけを追う。複雑な式は解釈しない

export interface ScannedArg {
  // 名前付き引数の名前。位置引数は null
  name: string | null;
  spread: boolean;
  // 引数全体 [start, end)（末尾の空白・コメントは含まない）
  start: number;
  end: number;
  // 値の範囲 [valueStart, valueEnd)
  valueStart: number;
  valueEnd: number;
}

export interface ScannedCall {
  // 呼び出し全体 [start, end)。start は `image` の先頭（マークアップの # は含まない）、end は `)` の直後
  start: number;
  end: number;
  // `(` と `)` の位置（閉じていなければ argsClose = end）
  argsOpen: number;
  argsClose: number;
  args: ScannedArg[];
}

const IDENT_RE = /[\p{XID_Start}_][\p{XID_Continue}_-]*/uy;
const NAMED_RE = /([\p{XID_Start}_][\p{XID_Continue}_-]*)\s*:/uy;
const IDENT_CHAR_RE = /[\p{XID_Continue}_-]/u;
const LINK_CHAR_RE = /[\p{L}\p{N}!#$%&*+,\-./:;=?@_~']/u;
const SET_BEFORE_RE = /(?:^|[^\p{XID_Continue}_-])set\s+$/u;
// 改行か ; までを 1 文として読むキーワード（マークアップ中の #let など）
const STATEMENT_KEYWORDS = new Set(["let", "set", "show", "import", "include", "return", "break", "continue"]);
// 後ろのブロックで終わるキーワード（else が続けば続ける）
const BLOCK_KEYWORDS = new Set(["if", "for", "while"]);

const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";

class Scanner {
  i = 0;
  calls: ScannedCall[] = [];

  constructor(readonly s: string) {}

  get eof(): boolean {
    return this.i >= this.s.length;
  }

  // コメントなら読み飛ばして true
  comment(): boolean {
    const s = this.s;
    const i = this.i;
    if (s[i] !== "/") return false;
    if (s[i + 1] === "/") {
      const nl = s.indexOf("\n", i);
      this.i = nl < 0 ? s.length : nl;
      return true;
    }
    if (s[i + 1] === "*") {
      let depth = 0;
      let j = i;
      while (j < s.length) {
        if (s.startsWith("/*", j)) {
          depth++;
          j += 2;
        } else if (s.startsWith("*/", j)) {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else j++;
      }
      this.i = j;
      return true;
    }
    return false;
  }

  // 空白とコメント
  trivia(): void {
    while (!this.eof) {
      if (isSpace(this.s[this.i])) this.i++;
      else if (!this.comment()) return;
    }
  }

  string(): void {
    this.i = stringEnd(this.s, this.i);
  }

  raw(): void {
    const s = this.s;
    let n = 0;
    while (s[this.i + n] === "`") n++;
    if (n === 2) {
      this.i += 2;
      return;
    }
    const fence = "`".repeat(n);
    const close = s.indexOf(fence, this.i + n);
    this.i = close < 0 ? s.length : close + n;
  }

  // http:// / https:// で始まるリンク（マークアップでは // をコメントにしない）
  link(): void {
    const s = this.s;
    this.i += s.startsWith("https://", this.i) ? 8 : 7;
    const stack: string[] = [];
    while (!this.eof) {
      const c = s[this.i];
      if (c === "(" || c === "[") stack.push(c === "(" ? ")" : "]");
      else if (c === ")" || c === "]") {
        if (stack.at(-1) !== c) return;
        stack.pop();
      } else if (!LINK_CHAR_RE.test(c)) return;
      this.i++;
    }
  }

  // マークアップ。close が "]" なら対応する ] を読んで戻る。null は末尾まで
  markup(close: "]" | null): void {
    const s = this.s;
    let depth = 0;
    while (!this.eof) {
      const c = s[this.i];
      if (c === "\\") this.i += 2;
      else if (c === "/" && this.comment()) continue;
      else if (c === "`") this.raw();
      else if (c === "$") {
        this.i++;
        this.math();
      } else if (c === "h" && (s.startsWith("http://", this.i) || s.startsWith("https://", this.i))) this.link();
      else if (c === "#") {
        this.i++;
        this.embedded();
      } else if (c === "[") {
        depth++;
        this.i++;
      } else if (c === "]") {
        this.i++;
        if (depth > 0) depth--;
        else if (close === "]") return;
      } else this.i++;
    }
  }

  // 数式。閉じる $ を読んで戻る
  math(): void {
    const s = this.s;
    while (!this.eof) {
      const c = s[this.i];
      if (c === "\\") this.i += 2;
      else if (c === "/" && this.comment()) continue;
      else if (c === '"') this.string();
      else if (c === "#") {
        this.i++;
        this.embedded();
      } else if (c === "$") {
        this.i++;
        return;
      } else this.i++;
    }
  }

  // マークアップ・数式中の # の後ろ（埋め込みコード式）
  embedded(): void {
    const s = this.s;
    const c = s[this.i];
    if (c === "{") {
      this.i++;
      this.codeUntil("}");
      this.i++;
      return;
    }
    if (c === "[") {
      this.i++;
      this.markup("]");
      return;
    }
    if (c === "(") {
      this.i++;
      this.codeUntil(")");
      this.i++;
      this.postfix(-1, "");
      return;
    }
    if (c === '"') {
      this.string();
      return;
    }
    IDENT_RE.lastIndex = this.i;
    const m = IDENT_RE.exec(s);
    if (!m) return;
    const start = this.i;
    const name = m[0];
    this.i += name.length;
    if (STATEMENT_KEYWORDS.has(name)) return this.line(false);
    if (BLOCK_KEYWORDS.has(name)) return this.line(true);
    if (name === "context") {
      while (s[this.i] === " " || s[this.i] === "\t") this.i++;
      return this.embedded();
    }
    this.postfix(start, name);
  }

  // 埋め込み式の後ろに続く呼び出し・コンテンツブロック・フィールドアクセス
  private postfix(start: number, name: string): void {
    const s = this.s;
    while (!this.eof) {
      const c = s[this.i];
      if (c === "(") {
        if (name === "image") this.imageCall(start);
        else {
          this.i++;
          this.codeUntil(")");
          this.i++;
        }
      } else if (c === "[") {
        this.i++;
        this.markup("]");
      } else if (c === ".") {
        IDENT_RE.lastIndex = this.i + 1;
        const m = IDENT_RE.exec(s);
        if (!m) return;
        this.i += 1 + m[0].length;
      } else return;
      name = "";
    }
  }

  // マークアップ中の文（#let など）。改行・; ・外側の ] で終わる。
  // blockEnds: if / for / while。ブロックを閉じた後に else が続かなければ終わる
  private line(blockEnds: boolean): void {
    const s = this.s;
    while (!this.eof) {
      const c = s[this.i];
      if (c === "\n" || c === ";" || c === "]") return;
      if (blockEnds && (c === "{" || c === "[")) {
        this.step();
        let j = this.i;
        while (s[j] === " " || s[j] === "\t") j++;
        if (!/^else(?![\p{XID_Continue}_-])/u.test(s.slice(j, j + 5))) return;
        this.i = j + 4;
        continue;
      }
      this.step();
    }
  }

  // コード。stops のどれかに当たったら（読まずに）その文字を返す。末尾なら null
  codeUntil(stops: string): string | null {
    while (!this.eof) {
      const c = this.s[this.i];
      if (stops.includes(c)) return c;
      this.step();
    }
    return null;
  }

  // コードのトークンを 1 つ（括弧なら閉じるまで）読む
  step(): void {
    const s = this.s;
    const c = s[this.i];
    if (c === "/" && this.comment()) return;
    if (c === '"') return this.string();
    if (c === "`") return this.raw();
    if (c === "$") {
      this.i++;
      return this.math();
    }
    if (c === "(" || c === "{") {
      this.i++;
      this.codeUntil(c === "(" ? ")" : "}");
      this.i++;
      return;
    }
    if (c === "[") {
      this.i++;
      return this.markup("]");
    }
    // 識別子の途中と、x.image( のようなフィールドアクセスは除く（..image( のスプレッドは除かない）
    const prev = s[this.i - 1];
    if (this.i === 0 || (!IDENT_CHAR_RE.test(prev) && (prev !== "." || s[this.i - 2] === "."))) {
      IDENT_RE.lastIndex = this.i;
      const m = IDENT_RE.exec(s);
      if (m) {
        const start = this.i;
        this.i += m[0].length;
        // set image(...) はスタイルの指定で、画像の呼び出しではない
        if (m[0] === "image" && s[this.i] === "(" && !SET_BEFORE_RE.test(s.slice(Math.max(0, start - 16), start))) {
          this.imageCall(start);
        }
        return;
      }
    }
    this.i++;
  }

  // image( の引数を 1 つずつ読む。this.i は ( の位置
  private imageCall(start: number): void {
    const s = this.s;
    const argsOpen = this.i;
    this.i++;
    const args: ScannedArg[] = [];
    let argsClose = -1;
    while (true) {
      this.trivia();
      if (this.eof) break;
      if (s[this.i] === ")") {
        argsClose = this.i;
        this.i++;
        break;
      }
      if (s[this.i] === ",") {
        this.i++;
        continue;
      }
      const argStart = this.i;
      const spread = s.startsWith("..", this.i);
      let name: string | null = null;
      if (!spread) {
        NAMED_RE.lastIndex = this.i;
        const m = NAMED_RE.exec(s);
        if (m) {
          name = m[1];
          this.i += m[0].length;
          this.trivia();
        }
      }
      const valueStart = this.i;
      let end = this.i;
      while (!this.eof && s[this.i] !== "," && s[this.i] !== ")") {
        if (isSpace(s[this.i])) this.i++;
        else if (s[this.i] === "/" && this.comment()) continue;
        else {
          this.step();
          end = this.i;
        }
      }
      args.push({ name, spread, start: argStart, end, valueStart, valueEnd: end });
    }
    // 引数の中の呼び出しが先に入る。開始位置の順には scanImageCalls で並べ直す
    this.calls.push({ start, end: this.i, argsOpen, argsClose: argsClose < 0 ? this.i : argsClose, args });
  }
}

// s[i] が " のとき、その文字列リテラルの直後の位置
export function stringEnd(s: string, i: number): number {
  let j = i + 1;
  while (j < s.length && s[j] !== '"') {
    if (s[j] === "\\") j++;
    j++;
  }
  return Math.min(j + 1, s.length);
}

const ESCAPES: Record<string, string> = { "\\": "\\", '"': '"', n: "\n", r: "\r", t: "\t" };

// 文字列リテラル（両端の " を含む）の中身
export function unescapeString(lit: string): string {
  const body = lit.slice(1, lit.endsWith('"') && lit.length > 1 ? -1 : undefined);
  return body.replace(/\\(u\{([0-9A-Fa-f]{1,6})\}|.)/gsu, (all, e: string, hex?: string) => {
    if (hex !== undefined) {
      const cp = parseInt(hex, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
    }
    return ESCAPES[e] ?? e;
  });
}

// 値を Typst の文字列リテラルにする
export function typstString(v: string): string {
  return `"${v.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

export function scanImageCalls(text: string): ScannedCall[] {
  const sc = new Scanner(text);
  sc.markup(null);
  return sc.calls.sort((a, b) => a.start - b.start);
}
