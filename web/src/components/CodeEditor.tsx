import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { forEachDiagnostic, lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { sortDiags, type CursorDiag } from "../lib/line-diag";
import { codePointsToUtf16 } from "../lib/text";
import { typstHighlight, typstLanguage } from "../lib/typst-lang";

// 行に出す診断。line / column は 1 始まり、column はコードポイント単位（typst の出力のまま）
export interface LineDiagnostic {
  line: number;
  column: number | null;
  severity: "error" | "warning";
  message: string;
}

export interface CodeEditorHandle {
  getDoc(): string;
  // 内容を差し替える。カーソルはできるだけ同じ行に残す
  setDoc(content: string, opts?: { resetHistory?: boolean }): void;
  // 1 始まりの行・列へ移動して画面に出す。列は UTF-16 単位（codepoints なら typst の診断と同じコードポイント単位）
  goto(line: number, column?: number, opts?: { codepoints?: boolean }): void;
  insert(text: string): void;
  undo(): void;
  redo(): void;
  focus(): void;
}

interface Props {
  // doc は CodeMirror の Text（文字列にするのは必要になったとき）
  onDocChange(doc: Text): void;
  // 0 始まり。character は UTF-16
  onCursor(line: number, character: number): void;
  // カーソルのある行に掛かる診断（変わったときだけ呼ぶ）
  onCursorDiagnostics?(ds: CursorDiag[]): void;
  onSave(): void;
  readOnly?: boolean;
  diagnostics?: LineDiagnostic[];
  // 幅の狭い画面。lint の列を外し、診断のある行は行の地の色で示す（行番号は残す）
  compact?: boolean;
  // エディタの下端に重ねたもの（診断の帯）の高さ。カーソルがその下に入らないように、スクロールの余白に取る
  bottomInset?: number;
}

function marginsExt(bottom: number) {
  return bottom > 0 ? EditorView.scrollMargins.of(() => ({ bottom })) : [];
}

// カーソルのある行に掛かる診断を、lint の状態から引く（編集で位置がずれても lint が追従している）
export function diagnosticsAtCursor(state: EditorState): CursorDiag[] {
  const line = state.doc.lineAt(state.selection.main.head);
  const out: CursorDiag[] = [];
  forEachDiagnostic(state, (d, from, to) => {
    if (from <= line.to && to >= line.from) out.push({ severity: d.severity === "error" ? "error" : "warning", message: d.message });
  });
  return sortDiags(out);
}

// 診断のある行の印（行の地の色。compact のときだけ CSS で色を付ける）
const setLineMarks = StateEffect.define<LineDiagnostic[]>();
const lineMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let d = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setLineMarks)) d = buildLineMarks(tr.state.doc, e.value);
    return d;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function buildLineMarks(doc: Text, ds: LineDiagnostic[]): DecorationSet {
  // 1 行に 1 つ。エラーを警告より優先する
  const byLine = new Map<number, "error" | "warning">();
  for (const d of ds) {
    if (d.line < 1 || d.line > doc.lines) continue;
    if (byLine.get(d.line) !== "error") byLine.set(d.line, d.severity);
  }
  const ranges = [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, sev]) => Decoration.line({ class: `cm-diag-line cm-diag-${sev}` }).range(doc.line(line).from));
  return Decoration.set(ranges);
}

function toCm(doc: Text, ds: LineDiagnostic[]): CmDiagnostic[] {
  const out: CmDiagnostic[] = [];
  for (const d of ds) {
    if (d.line < 1 || d.line > doc.lines) continue;
    const l = doc.line(d.line);
    let from = Math.min(l.from + codePointsToUtf16(l.text, Math.max(0, (d.column ?? 1) - 1)), l.to);
    // 列の位置から行末までに下線を引く（行末を指すときは直前の 1 文字）
    if (from === l.to && from > l.from) from -= 1;
    out.push({ from, to: l.to, severity: d.severity, message: d.message });
  }
  return out;
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const readOnly = useRef(new Compartment());
  const lastCursorDiags = useRef("[]");
  const emitCursorDiags = (state: EditorState) => {
    const ds = diagnosticsAtCursor(state);
    const key = JSON.stringify(ds);
    if (key === lastCursorDiags.current) return;
    lastCursorDiags.current = key;
    propsRef.current.onCursorDiagnostics?.(ds);
  };
  const gutter = useRef(new Compartment());
  const margins = useRef(new Compartment());

  const extensions = () => [
    lineNumbers(),
    highlightActiveLineGutter(),
    gutter.current.of(propsRef.current.compact ? [] : lintGutter()),
    margins.current.of(marginsExt(propsRef.current.bottomInset ?? 0)),
    lineMarks,
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    typstLanguage,
    typstHighlight,
    readOnly.current.of(roExt(propsRef.current.readOnly ?? false)),
    keymap.of([
      { key: "Mod-s", preventDefault: true, run: () => (propsRef.current.onSave(), true) },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.contentAttributes.of({ autocapitalize: "off", autocorrect: "off", spellcheck: "false" }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) propsRef.current.onDocChange(u.state.doc);
      if (u.selectionSet || u.docChanged) {
        const head = u.state.selection.main.head;
        const line = u.state.doc.lineAt(head);
        propsRef.current.onCursor(line.number - 1, head - line.from);
      }
      emitCursorDiags(u.state);
    }),
  ];

  const applyDiagnostics = (v: EditorView) => {
    const ds = propsRef.current.diagnostics ?? [];
    v.dispatch(setDiagnostics(v.state, toCm(v.state.doc, ds)));
    v.dispatch({ effects: setLineMarks.of(ds) });
  };

  useEffect(() => {
    const v = new EditorView({ state: EditorState.create({ doc: "", extensions: extensions() }), parent: host.current! });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnly.current.reconfigure(roExt(props.readOnly ?? false)) });
  }, [props.readOnly]);

  useEffect(() => {
    if (view.current) applyDiagnostics(view.current);
  }, [props.diagnostics]);

  useEffect(() => {
    view.current?.dispatch({ effects: gutter.current.reconfigure(props.compact ? [] : lintGutter()) });
  }, [props.compact]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const bottom = props.bottomInset ?? 0;
    // 余白が増えたら、カーソルを帯より上へ運ぶ
    v.dispatch({
      effects: [
        margins.current.reconfigure(marginsExt(bottom)),
        ...(bottom > 0 ? [EditorView.scrollIntoView(v.state.selection.main.head, { y: "nearest" })] : []),
      ],
    });
  }, [props.bottomInset]);

  useImperativeHandle(
    ref,
    () => ({
      getDoc: () => view.current?.state.doc.toString() ?? "",
      setDoc(content, opts = {}) {
        const v = view.current;
        if (!v) return;
        if (opts.resetHistory) {
          v.setState(EditorState.create({ doc: content, extensions: extensions() }));
          applyDiagnostics(v);
          return;
        }
        if (v.state.doc.toString() === content) return;
        const head = v.state.selection.main.head;
        const lineNo = v.state.doc.lineAt(head).number;
        const col = head - v.state.doc.lineAt(head).from;
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: content } });
        const doc = v.state.doc;
        const line = doc.line(Math.min(lineNo, doc.lines));
        v.dispatch({ selection: EditorSelection.cursor(Math.min(line.from + col, line.to)) });
        applyDiagnostics(v);
      },
      goto(line, column = 1, opts = {}) {
        const v = view.current;
        if (!v) return;
        const doc = v.state.doc;
        const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
        const col = Math.max(0, column - 1);
        const pos = Math.min(l.from + (opts.codepoints ? codePointsToUtf16(l.text, col) : col), l.to);
        v.dispatch({
          selection: EditorSelection.cursor(pos),
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
        });
        v.focus();
      },
      insert(text) {
        const v = view.current;
        if (!v || v.state.readOnly) return;
        v.dispatch(v.state.replaceSelection(text), { scrollIntoView: true });
      },
      undo: () => void (view.current && !view.current.state.readOnly && undo(view.current)),
      redo: () => void (view.current && !view.current.state.readOnly && redo(view.current)),
      focus: () => view.current?.focus(),
    }),
    [],
  );

  return <div className="code-editor" ref={host} data-readonly={props.readOnly ?? false} data-compact={props.compact ?? false} />;
});

function roExt(ro: boolean) {
  return [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)];
}
