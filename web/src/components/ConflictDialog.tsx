import { useRef } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "./ui/alert-dialog";
import { Button } from "./ui/button";

// 保存時にディスク側が変わっていた（409）。読み込み直すか、手元の内容で上書きするか（spec 6.4）
//   rev が null: ファイルが無くなった（作り直すか、このまま編集を続けるか）
//   content が null: ディスクの内容を読めない（2MB 超・UTF-8 でない）ので、読み込み直せない
export function ConflictDialog(props: {
  open: boolean;
  path: string;
  conflict: { rev: string | null; content: string | null } | null;
  onReload(): void;
  onOverwrite(): void;
  // 読み込み直せないとき: 手元の編集を捨てて保存しない
  onDiscard(): void;
}) {
  const c = props.conflict;
  const gone = c?.rev === null;
  const unreadable = !gone && c?.content === null;
  // 開いた直後のフォーカスはダイアログ自体に置く（どちらのボタンも手元かディスクの内容を捨てるので、先に当てない）
  const popup = useRef<HTMLDivElement>(null);
  return (
    <AlertDialog open={props.open}>
      <AlertDialogContent ref={popup} initialFocus={popup}>
        <AlertDialogTitle>{gone ? "ファイルが無くなった" : "ディスク側が変わった"}</AlertDialogTitle>
        <AlertDialogDescription>
          {gone
            ? `${props.path} は別の場所（LLM・git・別の端末）で削除されたか、移動されました。この画面の内容で作り直せます。`
            : unreadable
              ? `${props.path} はディスク上で書き換えられ、この画面では読めない内容（2MB 超、または UTF-8 でない）になっています。上書きすると、その内容は失われます。`
              : `${props.path} は開いた後に別の場所（LLM・git・別の端末）で書き換えられています。ディスクの内容を読み込み直すか、この画面の内容で上書きするかを選んでください。`}
        </AlertDialogDescription>
        <AlertDialogFooter>
          {!gone && !unreadable ? (
            <Button onClick={props.onReload}>再読込（手元の編集を捨てる）</Button>
          ) : (
            <Button onClick={props.onDiscard}>手元の編集を捨てる</Button>
          )}
          <Button variant="destructive" onClick={props.onOverwrite}>
            {gone ? "作り直す" : "上書き"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
