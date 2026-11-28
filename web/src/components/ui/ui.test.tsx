// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { cn } from "../../lib/cn";
import { Button } from "./button";
import { TabsList, TabsTrigger } from "./tabs";

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

describe("cn", () => {
  it("keeps the later of two conflicting utilities, including the sizes and radii added in styles.css", () => {
    expect(cn("px-3.5", "px-0")).toBe("px-0");
    expect(cn("text-md text-foreground", "text-[14px] text-muted-foreground")).toBe("text-[14px] text-muted-foreground");
    expect(cn("text-sm", "text-primary")).toBe("text-sm text-primary");
    expect(cn("rounded-box", "rounded-pill")).toBe("rounded-pill");
    expect(cn("text-input", "text-xs")).toBe("text-xs");
  });
});

describe("TabsTrigger", () => {
  it("shows the selected tab by aria-pressed, caps the font size and lets only the label shrink with an ellipsis", async () => {
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
    expect(on.className).toMatch(/text-\[min\(/);
    // ボタンに overflow を付けると、押せる範囲を広げる ::after が切られる
    expect(on.className).not.toMatch(/overflow|truncate/);
    expect(on.querySelector(".tab-label")!.className).toContain("truncate");
    expect(r.host.querySelector("nav")!.className).toContain("bg-tab-track");
    await r.done();
  });
});

describe("Button", () => {
  it("is a plain button by default and lets the caller override the size", async () => {
    const r = await render(
      <Button variant="ghost" className="px-0">
        ⇄
      </Button>,
    );
    const b = r.host.querySelector("button")!;
    expect(b.type).toBe("button");
    expect(b.className.split(" ")).toContain("px-0");
    expect(b.className).not.toMatch(/px-3\.5/);
    await r.done();
  });
});
