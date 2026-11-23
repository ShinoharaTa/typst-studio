import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConfigError,
  loadHostConfig,
  loadProjectConfig,
  parseHostConfig,
  parseProjectConfig,
  parseSize,
  projectConfigPath,
} from "../src/config.js";
import { checkArticle } from "../src/preview/manager.js";

const ctx = { home: "/h", dist: "/d", container: false, where: "config.toml" };
const dev = { auth: { mode: "none" } };

describe("host config", () => {
  it("uses defaults when only auth is given", () => {
    const c = parseHostConfig(dev, ctx);
    expect(c.server).toMatchObject({ bind: "127.0.0.1", port: 8796, allowedOrigins: [] });
    expect(c.preview).toMatchObject({ dataPlanePort: 23625, controlPlanePort: 23626, memoryMax: "600M", idleStopMinutes: 10 });
    expect(c.limits).toEqual({ driver: "auto", watchdogIntervalMs: 250 });
    expect(c.build).toEqual({
      memoryMax: "1500M",
      timeoutSeconds: 300,
      autoOnSave: true,
      autoDebounceSeconds: 5,
      keepGenerations: 2,
    });
    expect(c.fonts.extraPaths).toEqual(["/d/fonts"]);
  });

  it("reads every key of spec 10.3", () => {
    const c = parseHostConfig(
      {
        server: { bind: "127.0.0.1", port: 9000, public_url: "https://studio.example.test:8445" },
        auth: { mode: "tailscale", allow_users: ["user@example.com"] },
        limits: { driver: "watchdog", watchdog_interval_ms: 100 },
        preview: { data_plane_port: 1, control_plane_port: 2, memory_max: "500M", cpu_quota: "100%", idle_stop_minutes: 3 },
        build: { memory_max: "300M", timeout_seconds: 60, auto_on_save: false, auto_debounce_seconds: 2, keep_generations: 3 },
        fonts: { extra_paths: ["fonts", "more/fonts"] },
      },
      ctx,
    );
    expect(c.server.allowedOrigins).toEqual(["https://studio.example.test:8445"]);
    expect(c.auth).toEqual({ mode: "tailscale", allowUsers: ["user@example.com"] });
    expect(c.limits).toEqual({ driver: "watchdog", watchdogIntervalMs: 100 });
    expect(c.build.memoryMax).toBe("300M");
    expect(c.build.keepGenerations).toBe(3);
    expect(c.fonts.extraPaths).toEqual(["/d/fonts", "/d/more/fonts"]);
  });

  it("derives allowed Origin from public_url", () => {
    const o = (u: string) => parseHostConfig({ ...dev, server: { public_url: u } }, ctx).server.allowedOrigins;
    expect(o("https://a.example.test:8445/some/path")).toEqual(["https://a.example.test:8445"]);
    expect(o("https://b.example.test")).toEqual(["https://b.example.test"]);
    expect(() => o("not a url")).toThrow(/public_url/);
    expect(() => o("ftp://x")).toThrow(/http/);
  });

  it("rejects unknown sections and keys", () => {
    expect(() => parseHostConfig({ ...dev, git: {} }, ctx)).toThrow(/unknown key "git"/);
    expect(() => parseHostConfig({ ...dev, server: { prot: 1 } }, ctx)).toThrow(/unknown key "prot"/);
    expect(() => parseHostConfig({ ...dev, preview: { memory: "1G" } }, ctx)).toThrow(ConfigError);
    expect(() => parseHostConfig({ ...dev, build: { memory: "1G" } }, ctx)).toThrow(/unknown key "memory"/);
    expect(() => parseHostConfig({ ...dev, fonts: { paths: [] } }, ctx)).toThrow(/unknown key "paths"/);
  });

  it("validates values", () => {
    expect(() => parseHostConfig({ ...dev, build: { memory_max: "lots" } }, ctx)).toThrow(/memory_max/);
    expect(() => parseHostConfig({ ...dev, build: { keep_generations: 0 } }, ctx)).toThrow(/keep_generations/);
    expect(() => parseHostConfig({ ...dev, limits: { driver: "docker" } }, ctx)).toThrow(/driver/);
    expect(() => parseHostConfig({ ...dev, fonts: { extra_paths: ["../fonts"] } }, ctx)).toThrow(/\.\./);
    expect(() => parseHostConfig({ ...dev, fonts: { extra_paths: ["/opt/fonts"] } }, ctx)).toThrow(/relative/);
  });

  it("defaults to external auth (delegated to the front proxy) without allow_users", () => {
    expect(parseHostConfig({}, ctx).auth.mode).toBe("external");
    expect(() => parseHostConfig({ auth: { mode: "tailscale" } }, ctx)).toThrow(/allow_users/);
    expect(parseHostConfig({ auth: { mode: "tailscale", allow_users: ["u"] } }, ctx).auth.mode).toBe("tailscale");
    expect(
      parseHostConfig({ server: { bind: "0.0.0.0" }, auth: { mode: "external" } }, { ...ctx, container: true }).auth.mode,
    ).toBe("external");
    expect(() => parseHostConfig({ auth: { mode: "open" } }, ctx)).toThrow(/unknown mode/);
  });

  it("rejects empty or space-padded allow_users", () => {
    for (const u of ["", " ", "  ", " a@example.com", "a@example.com "]) {
      expect(() => parseHostConfig({ auth: { allow_users: ["ok@example.com", u] } }, ctx), JSON.stringify(u)).toThrow(
        /allow_users/,
      );
    }
  });

  it("validates watchdog_interval_ms as an integer >= 50", () => {
    expect(parseHostConfig({ ...dev, limits: { watchdog_interval_ms: 50 } }, ctx).limits.watchdogIntervalMs).toBe(50);
    for (const v of [49, 0, 100.5, "250"]) {
      expect(() => parseHostConfig({ ...dev, limits: { watchdog_interval_ms: v } }, ctx)).toThrow(/watchdog_interval_ms/);
    }
  });

  it("rejects auth.mode = none on a non-loopback bind in a container", () => {
    const c = { ...ctx, container: true };
    expect(() => parseHostConfig({ ...dev, server: { bind: "0.0.0.0" } }, c)).toThrow(/mode = "none"/);
    expect(parseHostConfig({ ...dev, server: { bind: "127.0.0.1" } }, c).auth.mode).toBe("none");
    expect(parseHostConfig({ server: { bind: "0.0.0.0" }, auth: { allow_users: ["u"] } }, c).server.bind).toBe("0.0.0.0");
  });

  it("rejects non-loopback bind unless container", () => {
    expect(() => parseHostConfig({ ...dev, server: { bind: "0.0.0.0" } }, ctx)).toThrow(/loopback/);
    const c = { ...ctx, container: true };
    expect(parseHostConfig({ server: { bind: "0.0.0.0" }, auth: { allow_users: ["u"] } }, c).server.bind).toBe("0.0.0.0");
  });

  it("parses sizes like systemd", () => {
    expect(parseSize("300M")).toBe(300 * 1024 * 1024);
    expect(parseSize("1G")).toBe(1024 ** 3);
    expect(parseSize("512")).toBe(512);
  });
});

describe("loadHostConfig", () => {
  let dir: string;
  beforeAll(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-home-"))));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("reads config.toml from TYPST_STUDIO_HOME and resolves fonts against TYPST_STUDIO_DIST", () => {
    const home = path.join(dir, "home");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, "config.toml"), '[auth]\nmode = "none"\n[build]\nmemory_max = "300M"\n');
    const c = loadHostConfig({ TYPST_STUDIO_HOME: home, TYPST_STUDIO_DIST: "/opt/typst-studio" });
    expect(c.home).toBe(home);
    expect(c.dist).toBe("/opt/typst-studio");
    expect(c.build.memoryMax).toBe("300M");
    expect(c.fonts.extraPaths).toEqual(["/opt/typst-studio/fonts"]);
  });

  it("fails on unknown keys in config.toml", () => {
    const home = path.join(dir, "bad");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, "config.toml"), '[auth]\nmode = "none"\n[git]\nbase = "main"\n');
    expect(() => loadHostConfig({ TYPST_STUDIO_HOME: home })).toThrow(/unknown key "git"/);
  });
});

describe("project config", () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ts-proj-"));
    fs.mkdirSync(path.join(root, "fonts"));
    fs.mkdirSync(path.join(root, "articles", "author-a", "sub"), { recursive: true });
    fs.writeFileSync(path.join(root, "articles", "author-a", "sub", "article.typ"), "");
    fs.writeFileSync(path.join(root, "preview.typ"), "");
    fs.writeFileSync(path.join(root, "main.typ"), "");
    fs.symlinkSync(os.tmpdir(), path.join(root, "escape"));
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  const pctx = () => ({ name: "sample-book", root, source: "typst-studio.toml" });
  // spec 2.3 の例をそのまま
  const base = () => ({
    project: { name: "sample-book", typst: "0.14.2" },
    fonts: { paths: ["fonts"], system: true },
    book: { entry: "main.typ", preview_profile: "print" },
    preview: { entry: "preview.typ", inputs: { ARTICLE: "{article_entry}", EBOOK: "true" } },
    articles: {
      glob: "articles/**/article.typ",
      image_dirs: ["images", "figures"],
      upload_dir: "images",
      override: [{ match: "articles/author-b/**", inputs: { CATEGORY: "example" } }],
    },
    profiles: {
      print: { entry: "main.typ", output: "main.pdf" },
      ebook: { entry: "main.typ", inputs: { EBOOK: "true" }, output: "ebook-body.pdf" },
      guide: { entry: "main.typ", inputs: { GUIDE: "true" }, output: "guide.pdf" },
    },
    image_fn: [{ name: "chapter-title-page", path_arg: 1, size_args: { height: 2, voffset: 3 } }],
  });

  it("parses every key of spec 2.3", () => {
    const c = parseProjectConfig(base(), pctx());
    expect(c.project).toEqual({ name: "sample-book", typst: "0.14.2" });
    expect(c.book).toEqual({ entry: "main.typ", previewProfile: "print" });
    expect(c.preview.inputs.ARTICLE).toBe("{article_entry}");
    expect(c.articles).toMatchObject({ imageDirs: ["images", "figures"], uploadDir: "images" });
    expect(c.articles.override[0].match).toBe("articles/author-b/**");
    expect(Object.keys(c.profiles)).toEqual(["print", "ebook", "guide"]);
    expect(c.profiles.print).toEqual({ entry: "main.typ", inputs: {}, output: "main.pdf" });
    expect(c.profiles.ebook.inputs).toEqual({ EBOOK: "true" });
    expect(c.imageFn).toEqual([{ name: "chapter-title-page", pathArg: 1, sizeArgs: { height: 2, voffset: 3 } }]);
  });

  it("falls back to book.entry when [preview] is absent", () => {
    const { preview: _, ...rest } = base();
    expect(parseProjectConfig(rest, pctx()).preview).toEqual({ entry: "main.typ", inputs: {} });
  });

  it("requires [project] typst, [book] and [articles]", () => {
    const { project: _p, ...noProject } = base();
    expect(() => parseProjectConfig(noProject, pctx())).toThrow(/\[project\] is required/);
    expect(() => parseProjectConfig({ ...base(), project: { name: "x" } }, pctx())).toThrow(/"typst" is required/);
    expect(() => parseProjectConfig({ ...base(), project: { typst: "latest" } }, pctx())).toThrow(/typst/);
    const { book: _b, ...noBook } = base();
    expect(() => parseProjectConfig(noBook, pctx())).toThrow(/\[book\] is required/);
    const { articles: _a, ...noArticles } = base();
    expect(() => parseProjectConfig(noArticles, pctx())).toThrow(/\[articles\] is required/);
  });

  it("rejects unknown keys, including [git]", () => {
    expect(() => parseProjectConfig({ ...base(), git: { base: "main" } }, pctx())).toThrow(/unknown key "git"/);
    expect(() => parseProjectConfig({ ...base(), book: { entry: "main.typ", branch: "x" } }, pctx())).toThrow(
      /unknown key "branch"/,
    );
    const pf = { ...base().profiles, print: { entry: "main.typ", output: "main.pdf", pages: "1-2" } };
    expect(() => parseProjectConfig({ ...base(), profiles: pf }, pctx())).toThrow(/unknown key "pages"/);
    const fn = [{ name: "f", path_arg: 0, size_arg: {} }];
    expect(() => parseProjectConfig({ ...base(), image_fn: fn }, pctx())).toThrow(/unknown key "size_arg"/);
  });

  it("rejects host-side keys", () => {
    for (const [sec, key] of [
      ["preview", "port"],
      ["preview", "memory_max"],
      ["book", "timeout_seconds"],
      ["fonts", "extra_paths"],
    ] as const) {
      const b = base() as Record<string, Record<string, unknown>>;
      expect(() => parseProjectConfig({ ...b, [sec]: { ...b[sec], [key]: 1 } }, pctx())).toThrow(`unknown key "${key}"`);
    }
    for (const sec of ["server", "auth", "limits", "build"]) {
      expect(() => parseProjectConfig({ ...base(), [sec]: {} }, pctx())).toThrow(`unknown key "${sec}"`);
    }
  });

  it("rejects undefined placeholders anywhere inputs are allowed", () => {
    expect(() =>
      parseProjectConfig({ ...base(), preview: { entry: "preview.typ", inputs: { X: "{nope}" } } }, pctx()),
    ).toThrow(/placeholder \{nope\}/);
    const ov = [{ match: "articles/**", inputs: { X: "{article}" } }];
    expect(() => parseProjectConfig({ ...base(), articles: { ...base().articles, override: ov } }, pctx())).toThrow(
      /placeholder/,
    );
    const pf = { print: { entry: "main.typ", inputs: { X: "{profile}" }, output: "main.pdf" } };
    expect(() => parseProjectConfig({ ...base(), profiles: pf }, pctx())).toThrow(/placeholder/);
  });

  it("rejects book.preview_profile not defined in [profiles.*]", () => {
    expect(() => parseProjectConfig({ ...base(), book: { entry: "main.typ", preview_profile: "nope" } }, pctx())).toThrow(
      /preview_profile.*"nope"/,
    );
    const { profiles: _, ...noProfiles } = base();
    expect(() => parseProjectConfig(noProfiles, pctx())).toThrow(/preview_profile/);
  });

  it("rejects missing paths", () => {
    expect(() => parseProjectConfig({ ...base(), fonts: { paths: ["missing"] } }, pctx())).toThrow(/does not exist/);
    expect(() => parseProjectConfig({ ...base(), book: { entry: "book.typ" } }, pctx())).toThrow(/does not exist/);
    expect(() =>
      parseProjectConfig({ ...base(), preview: { entry: "missing.typ" } }, pctx()),
    ).toThrow(/does not exist/);
    const pf = { ...base().profiles, print: { entry: "other.typ", output: "main.pdf" } };
    expect(() => parseProjectConfig({ ...base(), profiles: pf }, pctx())).toThrow(/does not exist/);
  });

  it("rejects empty, directory and '.' entries", () => {
    for (const entry of ["", ".", "articles", "fonts/"]) {
      expect(() => parseProjectConfig({ ...base(), book: { entry } }, pctx()), entry).toThrow(/empty|not a file/);
      expect(() => parseProjectConfig({ ...base(), preview: { entry } }, pctx()), entry).toThrow(/empty|not a file/);
      const pf = { ...base().profiles, print: { entry, output: "main.pdf" } };
      expect(() => parseProjectConfig({ ...base(), profiles: pf }, pctx()), entry).toThrow(/empty|not a file/);
    }
    expect(() => parseProjectConfig({ ...base(), fonts: { paths: [""] } }, pctx())).toThrow(/empty/);
  });

  it("rejects paths outside the repository (.., absolute, symlink)", () => {
    expect(() => parseProjectConfig({ ...base(), fonts: { paths: ["../x"] } }, pctx())).toThrow(/inside/);
    expect(() => parseProjectConfig({ ...base(), fonts: { paths: ["/usr/share/fonts"] } }, pctx())).toThrow(/inside/);
    expect(() => parseProjectConfig({ ...base(), fonts: { paths: ["escape"] } }, pctx())).toThrow(/outside/);
    expect(() => parseProjectConfig({ ...base(), book: { entry: "/etc/hosts" } }, pctx())).toThrow(/inside/);
    const a = base().articles;
    expect(() => parseProjectConfig({ ...base(), articles: { ...a, glob: "../**/article.typ" } }, pctx())).toThrow(/\.\./);
    expect(() => parseProjectConfig({ ...base(), articles: { ...a, image_dirs: ["../img"] } }, pctx())).toThrow(/\.\./);
    expect(() => parseProjectConfig({ ...base(), articles: { ...a, upload_dir: "/tmp" } }, pctx())).toThrow(/relative/);
    const pf = { ...base().profiles, print: { entry: "main.typ", output: "../main.pdf" } };
    expect(() => parseProjectConfig({ ...base(), profiles: pf }, pctx())).toThrow(/\.\./);
  });

  it("matches two-level articles with articles.glob", () => {
    const c = parseProjectConfig(base(), pctx());
    expect(checkArticle(c, "articles/author-a/sub/article.typ")).toBe("articles/author-a/sub/article.typ");
  });
});

describe("project config location", () => {
  let home: string;
  const write = (p: string, body: string) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  const toml = (typst: string) =>
    `[project]\ntypst = "${typst}"\n[book]\nentry = "main.typ"\n[articles]\nglob = "articles/**/article.typ"\n`;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "ts-loc-"));
    for (const n of ["both", "override-only", "none"]) write(path.join(home, "projects", n, "main.typ"), "");
    write(path.join(home, "projects", "both", "typst-studio.toml"), toml("0.14.2"));
    write(path.join(home, "project-overrides", "both.toml"), toml("0.13.1"));
    write(path.join(home, "project-overrides", "override-only.toml"), toml("0.13.1"));
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
  const host = () => parseHostConfig(dev, { ...ctx, home, dist: home });

  it("prefers typst-studio.toml in the repository over project-overrides", () => {
    expect(projectConfigPath(host(), "both")).toBe(path.join(home, "projects", "both", "typst-studio.toml"));
    expect(loadProjectConfig(host(), "both").project.typst).toBe("0.14.2");
  });

  it("falls back to project-overrides/<name>.toml", () => {
    expect(loadProjectConfig(host(), "override-only").project.typst).toBe("0.13.1");
  });

  it("explains what is missing when there is no typst-studio.toml", () => {
    expect(() => loadProjectConfig(host(), "none")).toThrow(/has no typst-studio\.toml/);
  });
});
