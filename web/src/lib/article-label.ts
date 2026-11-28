// 記事の見せ方。記事の名前 = 記事ディレクトリの名前。
// 全記事に共通する部分（先頭のディレクトリと、共通のファイル名）は出さず、途中の階層は見出しにする
//   articles/intro/article.typ          → name "intro"
//   articles/author-b/setup/article.typ → group ["author-b"], name "setup"
//   main.typ                            → name "main"
//   chapters/intro.typ, chapters/setup.typ（同じディレクトリに複数）→ group ["chapters"], name "intro" / "setup"

export interface ArticleCtx {
  // 全記事に共通する先頭のディレクトリの段数
  prefix: number;
  // 全記事のファイル名が同じ（それなら行にファイル名を出さない）
  sameFile: boolean;
  // 記事が 2 つ以上あるディレクトリ（ファイル名が違うときだけ。名前にファイル名を使う）
  sharedDirs: Set<string>;
  // ほかの記事と名前が重なる名前（「続きから」などでは親の階層も付ける）
  dupNames: Set<string>;
}

export interface ArticleLabel {
  name: string;
  group: string[];
  // ファイル名が記事ごとに違うときだけ、副題に出すファイル名
  file: string | null;
}

const split = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  return { dirs: parts.slice(0, -1), file: parts[parts.length - 1] ?? path };
};

const stem = (file: string) => file.replace(/\.typ$/i, "");

function label(path: string, ctx: Pick<ArticleCtx, "prefix" | "sameFile" | "sharedDirs">): ArticleLabel {
  const { dirs, file } = split(path);
  const rest = dirs.slice(Math.min(ctx.prefix, Math.max(0, dirs.length - 1)));
  if (rest.length === 0) return { name: stem(file), group: [], file: null };
  // 同じディレクトリに記事が複数ある: ディレクトリは見出しにし、名前はファイル名
  if (!ctx.sameFile && ctx.sharedDirs.has(dirs.join("/"))) return { name: stem(file), group: rest, file: null };
  return { name: rest[rest.length - 1], group: rest.slice(0, -1), file: ctx.sameFile ? null : file };
}

export function articleContext(paths: string[]): ArticleCtx {
  if (paths.length === 0) return { prefix: 0, sameFile: true, sharedDirs: new Set(), dupNames: new Set() };
  const all = paths.map(split);
  const minLen = Math.min(...all.map((p) => p.dirs.length));
  let prefix = 0;
  while (prefix < minLen && all.every((p) => p.dirs[prefix] === all[0].dirs[prefix])) prefix++;
  // 各記事に最低 1 段は残す（名前が空にならないように）
  prefix = Math.max(0, Math.min(prefix, minLen - 1));
  const sameFile = paths.length <= 1 || all.every((p) => p.file === all[0].file);
  const count = new Map<string, number>();
  for (const p of all) count.set(p.dirs.join("/"), (count.get(p.dirs.join("/")) ?? 0) + 1);
  const sharedDirs = new Set(sameFile ? [] : [...count].filter(([, n]) => n > 1).map(([d]) => d));
  const names = new Map<string, number>();
  for (const p of paths) {
    const n = label(p, { prefix, sameFile, sharedDirs }).name;
    names.set(n, (names.get(n) ?? 0) + 1);
  }
  const dupNames = new Set([...names].filter(([, n]) => n > 1).map(([n]) => n));
  return { prefix, sameFile, sharedDirs, dupNames };
}

export function articleLabel(path: string, ctx?: ArticleCtx): ArticleLabel {
  if (!ctx) {
    // 一覧をまだ読めていない: 親ディレクトリ名（無ければファイル名）
    const { dirs, file } = split(path);
    return { name: dirs.length ? dirs[dirs.length - 1] : stem(file), group: [], file: null };
  }
  return label(path, ctx);
}

// 一覧の外（「続きから」・プレビューの通知）で出す名前。ほかの記事と重なるなら親の階層も付ける（a / x）
export function articleTitle(path: string, ctx?: ArticleCtx): string {
  const l = articleLabel(path, ctx);
  return ctx?.dupNames.has(l.name) && l.group.length ? [...l.group, l.name].join(" / ") : l.name;
}

export const OTHER_GROUP = "その他";

// 記事一覧を見出し（group）ごとにまとめる。節は階層のパス順（見出しの無い節は最後）、節の中は API の並びのまま。
// 見出しのある節がほかにあるときは、見出しの無い節にも「その他」を付ける（直前の節の下に入って見えないように）
export function groupArticles<T extends { path: string }>(
  list: T[],
): { group: string[]; heading: string | null; items: (T & { label: ArticleLabel })[] }[] {
  const ctx = articleContext(list.map((a) => a.path));
  const byKey = new Map<string, { group: string[]; heading: string | null; items: (T & { label: ArticleLabel })[] }>();
  for (const a of list) {
    const l = articleLabel(a.path, ctx);
    const key = l.group.join("/");
    let g = byKey.get(key);
    if (!g) {
      g = { group: l.group, heading: l.group.length ? l.group.join(" / ") : null, items: [] };
      byKey.set(key, g);
    }
    g.items.push({ ...a, label: l });
  }
  const cmp = (a: string[], b: string[]) => {
    if (!a.length || !b.length) return b.length - a.length;
    const x = a.join("\u0000");
    const y = b.join("\u0000");
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const groups = [...byKey.values()].sort((a, b) => cmp(a.group, b.group));
  if (groups.some((g) => g.heading !== null)) for (const g of groups) g.heading ??= OTHER_GROUP;
  return groups;
}
