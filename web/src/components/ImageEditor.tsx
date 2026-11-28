import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../api/client";
import type { ImageCall, ImageSet } from "../api/types";
import { LatestOnly } from "../lib/schedule";
import { cn } from "../lib/cn";
import { formatLength, isValidLength, parseLength, toMm, type Unit } from "../lib/units";
import { AlertText } from "./ui/alert";
import { Button } from "./ui/button";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet, Input, Slider } from "./ui/input";
import { SegmentGroup, SegmentItem } from "./ui/segment";

// 画像 1 つの width / height / alt の編集（spec 4.4 / 4.7 段階 2）
//   操作中は PATCH dryRun → /api/preview/memory でプレビューだけ追従させ、ファイルは書かない。
//   「適用」で初めて書き込む。「取り消し」はメモリ上の内容を捨ててディスクの内容に戻す

// 画像のサムネイル（一覧の行・シートの見出し）。読めない画像は「?」
export function ImageThumb({ src, className }: { src: string | null; className?: string }) {
  const box = cn("size-12 flex-none rounded-thumb bg-card", className);
  return src ? (
    <img className={cn(box, "object-contain")} src={src} alt="" loading="lazy" />
  ) : (
    <span className={cn(box, "flex items-center justify-center text-muted-foreground")}>?</span>
  );
}

export interface ImageTarget {
  call: ImageCall;
  // 一覧から開いたときは分かっている。プレビューから開いたときは読み直す
  rev?: string;
}

const SLIDER: Record<"%" | "mm", { min: number; max: number; step: number }> = {
  "%": { min: 5, max: 100, step: 1 },
  mm: { min: 5, max: 300, step: 1 },
};

interface Draft {
  widthOn: boolean;
  value: number;
  // 数値欄の文字列（空欄・途中の入力を 0 にしない）
  valueText: string;
  unit: Unit;
  height: string;
  alt: string;
}

function draftFrom(c: ImageCall): Draft {
  const w = parseLength(c.width);
  return {
    widthOn: c.width !== null,
    value: w?.value ?? 100,
    valueText: String(w?.value ?? 100),
    unit: w?.unit ?? "%",
    height: c.height ?? "",
    alt: c.alt ?? "",
  };
}

// 元の呼び出しと違う引数だけを set にする。不正な値があれば null
function buildSet(c: ImageCall, d: Draft): ImageSet | null {
  const set: ImageSet = {};
  if (d.widthOn && !(d.valueText.trim() !== "" && Number.isFinite(d.value) && d.value > 0)) return null;
  const width = d.widthOn ? formatLength(d.value, d.unit) : null;
  if (width !== null && !isValidLength(width)) return null;
  const wOrig = parseLength(c.width);
  const sameWidth = width === null ? c.width === null : wOrig !== null && formatLength(wOrig.value, wOrig.unit) === width;
  if (!sameWidth) set.width = width;
  const h = d.height.trim();
  if (h !== "" && !isValidLength(h)) return null;
  if ((h || null) !== c.height) set.height = h || null;
  if ((d.alt || null) !== c.alt) set.alt = d.alt || null;
  return set;
}

const EDITOR = "flex flex-col gap-4";
const ACTIONS = "flex justify-end gap-2";

export function ImageEditor(props: {
  project: string;
  target: ImageTarget;
  onDone(applied?: { rev: string; call: ImageCall }): void;
  onGoto(call: ImageCall): void;
  // シートをスワイプで閉じたときに「取り消し」を呼べるようにする
  cancelRef?: RefObject<(() => void) | null>;
}) {
  const { project } = props;
  const [call, setCall] = useState(props.target.call);
  const [rev, setRev] = useState(props.target.rev);
  const [draft, setDraft] = useState(() => draftFrom(props.target.call));
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  const previewed = useRef(false);

  // プレビューから開いたときは rev が無いので、一覧を読み直して同じ呼び出しを探す
  useEffect(() => {
    if (props.target.rev) return;
    let cancelled = false;
    api.images(project, props.target.call.path).then(
      (list) => {
        if (cancelled) return;
        const c = props.target.call;
        const found =
          list.calls.find((x) => x.start === c.start) ?? list.calls.find((x) => x.line === c.line && x.column === c.column);
        setRev(list.rev);
        if (found) {
          setCall({ ...found, nearest: c.nearest });
          setDraft(draftFrom(found));
        }
      },
      (e: Error) => !cancelled && setLoadError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [project, props.target]);

  const set = useMemo(() => buildSet(call, draft), [call, draft]);

  // 適用も取り消しもせずに別の画像へ切り替わったら、追従でメモリに流した内容を捨てる
  const callPath = useRef(call.path);
  useEffect(
    () => () => {
      if (previewed.current) void api.previewMemoryReset(project, callPath.current).catch(() => undefined);
    },
    [project],
  );

  // 追従（途中の値は捨て、最後の値だけ流す）
  const follower = useMemo(
    () =>
      new LatestOnly<{ set: ImageSet; rev: string; call: ImageCall }>(async (v) => {
        let r: { content: string };
        try {
          r = await api.previewImage(project, { path: v.call.path, baseRev: v.rev, start: v.call.start, set: v.set });
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            // ディスク側が変わった。読み直して、次の操作からは新しい rev で追従する
            setFollowError("ファイルが変わったので読み込み直しました。もう一度動かしてください");
            const list = await api.images(project, v.call.path).catch(() => null);
            if (list) {
              setRev(list.rev);
              const found = list.calls.find((x) => x.start === v.call.start) ?? list.calls.find((x) => x.line === v.call.line);
              if (found) setCall(found);
            }
          } else {
            setFollowError(`プレビューに反映できません: ${(e as Error).message}`);
          }
          return;
        }
        setFollowError(null);
        previewed.current = true;
        await api.previewMemory(project, v.call.path, r.content).catch(() => undefined);
      }),
    [project],
  );

  const update = (p: Partial<Draft>) => {
    const next = { ...draft, ...p };
    setDraft(next);
    const s = buildSet(call, next);
    if (s && rev && call.editable) follower.push({ set: s, rev, call });
  };

  // 追従でメモリに流した内容を捨て、ディスクの内容に戻す
  const discard = async () => {
    follower.clear();
    await follower.settled();
    if (previewed.current) await api.previewMemoryReset(project, call.path).catch(() => undefined);
    previewed.current = false;
  };
  const cancel = async () => {
    await discard();
    props.onDone();
  };
  const gotoSource = async () => {
    await discard();
    props.onGoto(call);
  };
  if (props.cancelRef) props.cancelRef.current = () => void cancel();

  const apply = async () => {
    if (!set || !rev) return;
    if (Object.keys(set).length === 0) return props.onDone();
    setBusy(true);
    follower.clear();
    await follower.settled();
    try {
      const r = await api.patchImage(project, { path: call.path, baseRev: rev, start: call.start, set });
      await api.previewMemoryReset(project, call.path).catch(() => undefined);
      previewed.current = false;
      toast.success("適用しました");
      props.onDone(r);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.status === 409) {
        toast.error("ファイルが変わっていたので読み込み直しました。もう一度適用してください");
        const list = await api.images(project, call.path).catch(() => null);
        if (list) {
          setRev(list.rev);
          const found = list.calls.find((x) => x.start === call.start) ?? list.calls.find((x) => x.line === call.line);
          if (found) setCall(found);
        }
        return;
      }
      toast.error(`適用できません: ${(e as Error).message}`);
    }
  };

  const thumb = call.resolved ? api.rawUrl(project, call.resolved) : null;
  const head = (
    <div className="flex min-w-0 items-center gap-3">
      <ImageThumb src={thumb} className="size-16 bg-secondary" />
      <div className="min-w-0">
        <div className="font-mono text-sm wrap-anywhere">{call.src ?? "（式）"}</div>
        <Button variant="link" size="inline" className="whitespace-normal" onClick={() => void gotoSource()}>
          ソースへ（{call.path}:{call.line}）
        </Button>
        {call.nearest && <div className="text-sm text-muted-foreground">タップした位置に近い画像</div>}
      </div>
    </div>
  );

  if (!call.editable) {
    return (
      <div className={EDITOR}>
        {head}
        <AlertText className="m-0">編集不可（第 1 引数がリテラルでない、またはテンプレート内の画像）</AlertText>
        <div className={ACTIONS}>
          <Button onClick={() => props.onDone()}>閉じる</Button>
        </div>
      </div>
    );
  }

  const sliderUnit = draft.unit === "%" ? "%" : draft.unit === "mm" ? "mm" : null;
  const mm = toMm({ value: draft.value, unit: draft.unit });
  const heightInvalid = draft.height.trim() !== "" && !isValidLength(draft.height.trim());

  return (
    <div className={EDITOR}>
      {head}
      {loadError && (
        <AlertText variant="destructive" className="m-0">
          {loadError}
        </AlertText>
      )}
      {followError && (
        <AlertText variant="destructive" className="m-0">
          {followError}
        </AlertText>
      )}

      <FieldSet>
        <FieldLegend>幅（width）</FieldLegend>
        <SegmentGroup aria-label="単位">
          {(["%", "mm"] as const).map((u) => (
            <SegmentItem
              key={u}
              pressed={draft.widthOn && draft.unit === u}
              onClick={() => {
                // 単位を変えるときは、分かる範囲で同じ大きさに換算する
                const v = u === "mm" && mm !== null ? Math.round(mm) : draft.unit === u ? draft.value : u === "%" ? 100 : 80;
                update({ widthOn: true, unit: u, value: v, valueText: String(v) });
              }}
            >
              {u}
            </SegmentItem>
          ))}
          <SegmentItem pressed={!draft.widthOn} onClick={() => update({ widthOn: false })}>
            指定なし
          </SegmentItem>
        </SegmentGroup>
        {draft.widthOn && (
          <div className="flex items-center gap-3">
            {sliderUnit && (
              <Slider
                min={SLIDER[sliderUnit].min}
                max={SLIDER[sliderUnit].max}
                step={SLIDER[sliderUnit].step}
                value={draft.value}
                onChange={(e) => update({ value: Number(e.target.value), valueText: e.target.value })}
                aria-label="幅"
              />
            )}
            <label className="flex flex-none items-center gap-1">
              <Input
                type="number"
                className="w-[5.5em] px-2"
                inputMode="decimal"
                min={0}
                step="any"
                value={draft.valueText}
                onChange={(e) => update({ value: Number(e.target.value), valueText: e.target.value })}
                aria-label="幅の数値"
              />
              <span>{draft.unit}</span>
            </label>
          </div>
        )}
        {draft.widthOn && draft.unit !== "%" && mm !== null && draft.unit !== "mm" && (
          <p className="text-sm text-muted-foreground">≒ {Math.round(mm * 10) / 10} mm</p>
        )}
      </FieldSet>

      <Field>
        <FieldLabel>高さ（height）</FieldLabel>
        <Input
          aria-invalid={heightInvalid}
          placeholder="例: 8em / 40mm（空欄で指定なし）"
          value={draft.height}
          onChange={(e) => update({ height: e.target.value })}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {heightInvalid && <FieldError>数値 + 単位（% mm cm pt em in）で書いてください</FieldError>}
      </Field>

      <Field>
        <FieldLabel>代替テキスト（alt）</FieldLabel>
        <Input value={draft.alt} onChange={(e) => update({ alt: e.target.value })} />
      </Field>

      <div className={ACTIONS}>
        <Button onClick={() => void cancel()} disabled={busy}>
          取り消し
        </Button>
        <Button variant="primary" onClick={() => void apply()} disabled={busy || !set || !rev || Object.keys(set).length === 0}>
          適用
        </Button>
      </div>
    </div>
  );
}
