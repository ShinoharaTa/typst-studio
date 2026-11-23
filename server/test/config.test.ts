import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigError, parseHostConfig, parseProjectConfig } from "../src/config.js";

const ctx = { home: "/h", dist: "/h", container: false, where: "config.toml" };

describe("host config", () => {
  it("uses defaults when empty", () => {
    const c = parseHostConfig({}, ctx);
    expect(c.server).toMatchObject({ bind: "127.0.0.1", port: 8796 });
    expect(c.preview).toMatchObject({ dataPlanePort: 23625, controlPlanePort: 23626, memoryMax: "600M", idleStopMinutes: 10 });
    expect(c.limits.driver).toBe("auto");
  });

  it("rejects unknown sections and keys", () => {
    expect(() => parseHostConfig({ git: {} }, ctx)).toThrow(/unknown key "git"/);
    expect(() => parseHostConfig({ server: { prot: 1 } }, ctx)).toThrow(/unknown key "prot"/);
    expect(() => parseHostConfig({ preview: { memory: "1G" } }, ctx)).toThrow(ConfigError);
  });

  it("rejects non-loopback bind unless container", () => {
    expect(() => parseHostConfig({ server: { bind: "0.0.0.0" } }, ctx)).toThrow(/loopback/);
    expect(parseHostConfig({ server: { bind: "0.0.0.0" } }, { ...ctx, container: true }).server.bind).toBe("0.0.0.0");
  });
});

describe("project config", () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ts-proj-"));
    fs.mkdirSync(path.join(root, "fonts"));
    fs.writeFileSync(path.join(root, "preview.typ"), "");
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  const pctx = () => ({ name: "p", root, source: "typst-studio.toml" });
  const base = () => ({
    fonts: { paths: ["fonts"], system: true },
    preview: { entry: "preview.typ", inputs: { ARTICLE: "{article_entry}", EBOOK: "true" } },
    articles: { glob: "articles/**/article.typ", override: [{ match: "articles/a/**", inputs: { CATEGORY: "example" } }] },
  });

  it("parses the spec 2.3 subset", () => {
    const c = parseProjectConfig(base(), pctx());
    expect(c.preview.inputs.ARTICLE).toBe("{article_entry}");
    expect(c.articles.override[0].match).toBe("articles/a/**");
  });

  it("rejects unknown keys, including host-side keys", () => {
    expect(() => parseProjectConfig({ ...base(), git: {} }, pctx())).toThrow(/unknown key "git"/);
    expect(() => parseProjectConfig({ ...base(), preview: { ...base().preview, port: 1 } }, pctx())).toThrow(/unknown key "port"/);
  });

  it("rejects undefined placeholders and paths outside the repository", () => {
    expect(() =>
      parseProjectConfig({ ...base(), preview: { entry: "preview.typ", inputs: { X: "{nope}" } } }, pctx()),
    ).toThrow(/placeholder/);
    expect(() => parseProjectConfig({ ...base(), fonts: { paths: ["../x"] } }, pctx())).toThrow(/inside/);
    expect(() => parseProjectConfig({ ...base(), fonts: { paths: ["missing"] } }, pctx())).toThrow(/does not exist/);
  });
});
