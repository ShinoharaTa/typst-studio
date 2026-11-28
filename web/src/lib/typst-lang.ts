import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Typst の簡易ハイライト（spec 4.3。既存パッケージが無いので StreamLanguage で書く）
// マークアップ / コード（# の後と括弧の中）/ 数式（$ ... $）を大まかに追う

type Mode = "markup" | "code" | "math";

interface State {
  // 括弧の入れ子ごとのモード。[ ] はマークアップ、( ) { } はコード
  stack: Mode[];
  inBlockComment: number;
  inRaw: number; // ``` の長さ。0 は raw の外
  // # の直後（識別子 1 つ分だけコード）
  hashExpr: boolean;
  // #let などの行（括弧の外でも行末までコード）
  lineCode: boolean;
}

const KEYWORDS = new Set([
  "let", "set", "show", "if", "else", "for", "in", "while", "break", "continue",
  "return", "import", "include", "context", "and", "or", "not", "none", "auto", "true", "false",
]);

const STATEMENTS = new Set(["let", "set", "show", "import", "include", "if", "for", "while", "return", "context"]);

const mode = (s: State): Mode => s.stack[s.stack.length - 1] ?? (s.lineCode ? "code" : "markup");

const parser: StreamParser<State> = {
  name: "typst",
  startState: () => ({ stack: [], inBlockComment: 0, inRaw: 0, hashExpr: false, lineCode: false }),
  copyState: (s) => ({ ...s, stack: [...s.stack] }),

  token(stream, s) {
    if (stream.sol()) s.lineCode = false;
    if (s.inBlockComment > 0) {
      while (!stream.eol()) {
        if (stream.match("*/")) {
          if (--s.inBlockComment === 0) return "comment";
        } else if (stream.match("/*")) s.inBlockComment++;
        else stream.next();
      }
      return "comment";
    }
    if (s.inRaw > 0) {
      const fence = "`".repeat(s.inRaw);
      while (!stream.eol()) {
        if (stream.match(fence)) {
          s.inRaw = 0;
          return "monospace";
        }
        stream.next();
      }
      return "monospace";
    }

    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      s.inBlockComment = 1;
      return "comment";
    }

    const m = mode(s);

    // 文字列はコードと数式の中だけ
    if (m !== "markup" || s.hashExpr) {
      if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) {
        s.hashExpr = false;
        return "string";
      }
    }

    if (s.hashExpr) {
      s.hashExpr = false;
      const id = stream.match(/^[\p{L}_][\p{L}\p{N}_-]*/u) as RegExpMatchArray | null;
      if (id) {
        if (KEYWORDS.has(id[0])) {
          // #let / #set / #show などは行末までコード
          if (STATEMENTS.has(id[0])) s.lineCode = true;
          return "keyword";
        }
        return stream.peek() === "(" || stream.peek() === "[" ? "variableName.function" : "variableName";
      }
    }

    const ch = stream.peek();

    if (ch === "`") {
      const fence = stream.match(/^`+/) as RegExpMatchArray;
      const n = fence[0].length;
      if (n === 1) {
        if (stream.skipTo("`")) stream.next();
        else stream.skipToEnd();
        return "monospace";
      }
      s.inRaw = n;
      return "monospace";
    }

    if (ch === "(" || ch === "{" || ch === "[") {
      stream.next();
      s.stack.push(ch === "[" ? "markup" : "code");
      return "bracket";
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      stream.next();
      s.stack.pop();
      // ](…) や ][ と続く関数呼び出しの引数
      return "bracket";
    }

    if (m === "math") {
      if (ch === "$") {
        stream.next();
        s.stack.pop();
        return "keyword";
      }
      if (stream.match(/^[\p{L}][\p{L}\p{N}]*/u)) return "variableName";
      if (stream.match(/^\d+(\.\d+)?/)) return "number";
      stream.next();
      return null;
    }

    if (m === "code") {
      if (stream.match(/^\d+(\.\d+)?(%|mm|cm|pt|em|in|fr|deg|rad)?/)) return "number";
      const id = stream.match(/^[\p{L}_][\p{L}\p{N}_-]*/u) as RegExpMatchArray | null;
      if (id) {
        if (KEYWORDS.has(id[0])) return "keyword";
        if (stream.peek() === ":") return "propertyName";
        return stream.peek() === "(" || stream.peek() === "[" ? "variableName.function" : "variableName";
      }
      if (ch === "#") {
        stream.next();
        s.hashExpr = true;
        return "keyword";
      }
      if (ch === "$") {
        stream.next();
        s.stack.push("math");
        return "keyword";
      }
      if (stream.match(/^(=>|==|!=|<=|>=|\.\.|[-+*/=<>:.,;])/)) return "operator";
      stream.next();
      return null;
    }

    // マークアップ
    if (stream.sol() && stream.match(/^\s*=+\s.*$/)) return "heading";
    if (ch === "#") {
      stream.next();
      s.hashExpr = true;
      return "keyword";
    }
    if (ch === "$") {
      stream.next();
      s.stack.push("math");
      return "keyword";
    }
    if (ch === "\\") {
      stream.next();
      stream.next();
      return "escape";
    }
    if (stream.match(/^<[\p{L}\p{N}_:.-]+>/u)) return "labelName";
    if (stream.match(/^@[\p{L}\p{N}_:.-]+/u)) return "link";
    if (stream.match(/^\*[^*\n]+\*/)) return "strong";
    if (stream.match(/^_[^_\n]+_/)) return "emphasis";
    if (stream.sol() && stream.match(/^\s*([-+]|\d+\.)\s/)) return "list";
    if (stream.match(/^https?:\/\/[^\s\])]+/)) return "url";
    stream.next();
    return null;
  },

  blankLine(s) {
    s.hashExpr = false;
    s.lineCode = false;
  },

  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
};

export const typstLanguage = StreamLanguage.define(parser);

export const typstHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.comment, color: "var(--hl-comment)", fontStyle: "italic" },
    { tag: t.string, color: "var(--hl-string)" },
    { tag: [t.keyword, t.operator], color: "var(--hl-keyword)" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--hl-function)" },
    { tag: t.propertyName, color: "var(--hl-property)" },
    { tag: t.number, color: "var(--hl-number)" },
    { tag: t.heading, color: "var(--hl-heading)", fontWeight: "600" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: [t.monospace], color: "var(--hl-raw)" },
    { tag: [t.labelName, t.link, t.url], color: "var(--hl-link)" },
    { tag: t.escape, color: "var(--hl-number)" },
    { tag: t.list, color: "var(--hl-keyword)" },
    { tag: t.bracket, color: "var(--hl-bracket)" },
  ]),
);
