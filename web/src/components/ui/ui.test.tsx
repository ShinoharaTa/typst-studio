// @vitest-environment jsdom
import { Play } from "lucide-react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { cn } from "../../lib/cn";
import { Alert } from "./alert";
import { Button } from "./button";
import { ListItemSplit } from "./list";
import { SegmentGroup, SegmentItem, TabsList, TabsTrigger } from "./tabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    done: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const tokens = (el: Element) => el.className.split(/\s+/);

describe("cn", () => {
  it("keeps the later of two conflicting utilities, including the sizes and radii added in styles.css", () => {
    expect(cn("px-3", "px-0")).toBe("px-0");
    expect(cn("text-body text-foreground", "text-caption text-muted-foreground")).toBe("text-caption text-muted-foreground");
    expect(cn("text-caption", "text-primary")).toBe("text-caption text-primary");
    expect(cn("rounded-box", "rounded-pill")).toBe("rounded-pill");
    expect(cn("rounded-t-float", "rounded-t-box")).toBe("rounded-t-box");
    expect(cn("text-input", "text-title")).toBe("text-title");
    expect(cn("shadow-float", "shadow-sheet")).toBe("shadow-sheet");
  });
});

describe("TabsTrigger / SegmentItem", () => {
  it("shows the selected tab by aria-pressed and lets only the label shrink with an ellipsis", async () => {
    const r = await render(
      <TabsList aria-label="表示">
        <TabsTrigger active onClick={() => undefined}>
          編集
        </TabsTrigger>
        <TabsTrigger active={false} onClick={() => undefined}>
          プレビュー
        </TabsTrigger>
      </TabsList>,
    );
    const [on, off] = r.host.querySelectorAll("button");
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(tokens(on)).toContain("text-body");
    expect(on.className).not.toMatch(/-\[/);
    // ボタンに overflow を付けると、押せる範囲を広げる ::after が切られる
    expect(on.className).not.toMatch(/overflow|truncate/);
    expect(on.querySelector(".tab-label")!.className).toContain("truncate");
    expect(tokens(r.host.querySelector("nav")!)).toEqual(expect.arrayContaining(["flex", "bg-tab-track"]));
    await r.done();
  });

  it("builds tabs and segments the same way, and never lets hover or press take the selected color away", async () => {
    const r = await render(
      <>
        <TabsList>
          <TabsTrigger active onClick={() => undefined}>
            a
          </TabsTrigger>
        </TabsList>
        <SegmentGroup aria-label="単位">
          <SegmentItem pressed>%</SegmentItem>
        </SegmentGroup>
      </>,
    );
    const [tab, seg] = r.host.querySelectorAll("button");
    for (const b of [tab, seg]) {
      expect(tokens(b)).toEqual(expect.arrayContaining(["aria-pressed:bg-tab-on", "aria-pressed:text-primary", "rounded-pill"]));
      // 押した・ホバーの地は、選ばれていないものだけ
      for (const t of tokens(b).filter((t) => /(^|:)(hover|active):bg-/.test(t))) expect(t).toMatch(/^not-aria-pressed:/);
    }
    expect(r.host.querySelector("[role=group]")!.className).toContain("bg-tab-track");
    await r.done();
  });
});

describe("Button", () => {
  it("has 2 heights; sm keeps a 44px hit area with ::after, and the box color comes from the surface", async () => {
    const r = await render(
      <>
        <Button>通常</Button>
        <Button size="sm" variant="ghost" icon aria-label="拡大">
          +
        </Button>
        <Button variant="primary" disabled>
          適用
        </Button>
      </>,
    );
    const [md, sm, primary] = r.host.querySelectorAll("button");
    expect(md.type).toBe("button");
    expect(tokens(md)).toEqual(expect.arrayContaining(["min-h-11", "rounded-box", "bg-box", "text-body"]));
    expect(tokens(sm)).toEqual(expect.arrayContaining(["min-h-9", "after:-inset-1", "relative", "text-caption", "min-w-9"]));
    // 無効な主ボタンは塗りをやめる
    expect(tokens(primary)).toEqual(expect.arrayContaining(["disabled:bg-box", "disabled:text-muted-foreground"]));
    for (const b of [md, sm, primary]) expect(b.className).not.toMatch(/rounded-pill|(text|rounded|bg|p[xy]?)-\[/);
    await r.done();
  });
});

describe("Alert / ListItemSplit", () => {
  it("puts the alert's action on the box-inside level, so a secondary button inside stands out from the alert", async () => {
    const r = await render(<Alert action={<Button>再開</Button>}>停止しています</Alert>);
    const button = r.host.querySelector("button")!;
    expect(button.parentElement!.className).toContain("box-inside");
    expect(tokens(button)).toContain("bg-box");
    await r.done();
  });

  it("keeps the row body and the trailing action as separate buttons (no nested buttons)", async () => {
    const r = await render(
      <ListItemSplit onClick={() => undefined} actions={<Button size="sm">12 行</Button>}>
        本体
      </ListItemSplit>,
    );
    const buttons = r.host.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0].contains(buttons[1])).toBe(false);
    expect(r.host.querySelector("[data-slot=list-item]")!.className).toContain("bg-box");
    await r.done();
  });
});

describe("icons (lucide-react)", () => {
  it("are hidden from screen readers unless labelled", async () => {
    const r = await render(<Play />);
    expect(r.host.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    await r.done();
  });
});
