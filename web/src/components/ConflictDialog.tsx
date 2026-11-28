import { AlertDialog } from "@base-ui/react/alert-dialog";

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
  return (
    <AlertDialog.Root open={props.open}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="dialog-backdrop" />
        <AlertDialog.Popup className="dialog">
          <AlertDialog.Title className="dialog-title">{gone ? "ファイルが無くなった" : "ディスク側が変わった"}</AlertDialog.Title>
          <AlertDialog.Description className="dialog-text">
            {gone
              ? `${props.path} は別の場所（LLM・git・別の端末）で削除されたか、移動されました。この画面の内容で作り直せます。`
              : unreadable
                ? `${props.path} はディスク上で書き換えられ、この画面では読めない内容（2MB 超、または UTF-8 でない）になっています。上書きすると、その内容は失われます。`
                : `${props.path} は開いた後に別の場所（LLM・git・別の端末）で書き換えられています。ディスクの内容を読み込み直すか、この画面の内容で上書きするかを選んでください。`}
          </AlertDialog.Description>
          <div className="dialog-actions">
            {!gone && !unreadable ? (
              <button type="button" className="btn" onClick={props.onReload}>
                再読込（手元の編集を捨てる）
              </button>
            ) : (
              <button type="button" className="btn" onClick={props.onDiscard}>
                手元の編集を捨てる
              </button>
            )}
            <button type="button" className="btn btn-danger" onClick={props.onOverwrite}>
              {gone ? "作り直す" : "上書き"}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
