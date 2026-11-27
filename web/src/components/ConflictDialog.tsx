import { AlertDialog } from "@base-ui/react/alert-dialog";

// 保存時にディスク側が変わっていた（409）。読み込み直すか、手元の内容で上書きするか（spec 6.4）
export function ConflictDialog(props: { open: boolean; path: string; onReload(): void; onOverwrite(): void }) {
  return (
    <AlertDialog.Root open={props.open}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="dialog-backdrop" />
        <AlertDialog.Popup className="dialog">
          <AlertDialog.Title className="dialog-title">ディスク側が変わった</AlertDialog.Title>
          <AlertDialog.Description className="dialog-text">
            {props.path} は開いた後に別の場所（LLM・git・別の端末）で書き換えられています。
            ディスクの内容を読み込み直すか、この画面の内容で上書きするかを選んでください。
          </AlertDialog.Description>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={props.onReload}>
              再読込（手元の編集を捨てる）
            </button>
            <button type="button" className="btn btn-danger" onClick={props.onOverwrite}>
              上書き
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
