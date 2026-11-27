import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { codePointsToUtf16 } from "../lib/text";
import { typstHighlight, typstLanguage } from "../lib/typst-lang";

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
  onDocChange(): void;
  // 0 始まり
  onCursor(line: number, character: number): void;
  onSave(): void;
}

function makeState(doc: string, extensions: ReturnType<typeof buildExtensions>): EditorState {
  return EditorState.create({ doc, extensions });
}

function buildExtensions(p: { current: Props }) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    typstLanguage,
    typstHighlight,
    keymap.of([
      { key: "Mod-s", preventDefault: true, run: () => (p.current.onSave(), true) },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.contentAttributes.of({ autocapitalize: "off", autocorrect: "off", spellcheck: "false" }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) p.current.onDocChange();
      if (u.selectionSet || u.docChanged) {
        const head = u.state.selection.main.head;
        const line = u.state.doc.lineAt(head);
        p.current.onCursor(line.number - 1, head - line.from);
      }
    }),
  ];
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const extensions = useRef<ReturnType<typeof buildExtensions> | null>(null);

  useEffect(() => {
    extensions.current = buildExtensions(propsRef);
    const v = new EditorView({ state: makeState("", extensions.current), parent: host.current! });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getDoc: () => view.current?.state.doc.toString() ?? "",
      setDoc(content, opts = {}) {
        const v = view.current;
        if (!v) return;
        if (opts.resetHistory) {
          v.setState(makeState(content, extensions.current!));
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
        if (!v) return;
        v.dispatch(v.state.replaceSelection(text), { scrollIntoView: true });
      },
      undo: () => void (view.current && undo(view.current)),
      redo: () => void (view.current && redo(view.current)),
      focus: () => view.current?.focus(),
    }),
    [],
  );

  return <div className="code-editor" ref={host} />;
});
