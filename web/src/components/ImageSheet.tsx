import { Drawer } from "@base-ui/react/drawer";
import { useEffect, useRef, useState } from "react";
import type { ImageCall } from "../api/types";
import { ImageEditor, type ImageTarget } from "./ImageEditor";

// 画像サイズのシート（下から出す）。プレビューを見ながら動かせるように、背景を塞がない
export function ImageSheet(props: {
  project: string;
  target: ImageTarget | null;
  onClose(applied?: { rev: string; call: ImageCall }): void;
  onGoto(call: ImageCall): void;
  // 2 ペインのとき、エディタのある側（プレビューを隠さないように、その半分に寄せる）。1 ペインは null
  side?: "left" | "right" | null;
}) {
  // 閉じるアニメーションの間も中身を出しておく
  const [shown, setShown] = useState(props.target);
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (props.target) setShown(props.target);
  }, [props.target]);

  return (
    <Drawer.Root
      open={props.target !== null}
      modal={false}
      disablePointerDismissal
      onOpenChange={(open) => {
        // スワイプで閉じたときは「取り消し」と同じ扱いにする（ImageEditor の取り消しを通す）
        if (!open) (cancelRef.current ?? (() => props.onClose()))();
      }}
      onOpenChangeComplete={(open) => !open && setShown(null)}
    >
      <Drawer.Portal>
        <Drawer.Viewport className="sheet-viewport" data-side={props.side ?? undefined}>
          <Drawer.Popup className="sheet">
            <div className="sheet-handle" aria-hidden />
            <Drawer.Title className="sheet-title">画像</Drawer.Title>
            {shown && (
              // 別の画像に切り替わったら作り直す
              <ImageEditor
                key={`${shown.call.path}:${shown.call.start}`}
                project={props.project}
                target={shown}
                onDone={props.onClose}
                onGoto={props.onGoto}
                cancelRef={cancelRef}
              />
            )}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
