// 記事の見せ方。記事の名前 = 記事ディレクトリの名前。
// 全記事に共通する部分（先頭のディレクトリと、共通のファイル名）は出さず、途中の階層は見出しにする
//   articles/intro/article.typ          → name "intro"
//   articles/author-b/setup/article.typ → group ["author-b"], name "setup"
//   main.typ                            → name "main"

export interface ArticleCtx {
  // 全記事に共通する先頭のディレクトリの段数
  prefix: number;
  // 全記事のファイル名が同じ（それなら行にファイル名を出さない）
  sameFile: boolean;
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

export function articleContext(paths: string[]): ArticleCtx {
  if (paths.length === 0) return { prefix: 0, sameFile: true };
  const all = paths.map(split);
  const minLen = Math.min(...all.map((p) => p.dirs.length));
  let prefix = 0;
  while (prefix < minLen && all.every((p) => p.dirs[prefix] === all[0].dirs[prefix])) prefix++;
  // 各記事に最低 1 段は残す（名前が空にならないように）
  prefix = Math.max(0, Math.min(prefix, minLen - 1));
  const sameFile = paths.length <= 1 || all.every((p) => p.file === all[0].file);
  return { prefix, sameFile };
}

export function articleLabel(path: string, ctx?: ArticleCtx): ArticleLabel {
  const { dirs, file } = split(path);
  if (!ctx) return { name: dirs.length ? dirs[dirs.length - 1] : stem(file), group: [], file: null };
  const rest = dirs.slice(Math.min(ctx.prefix, Math.max(0, dirs.length - 1)));
  if (rest.length === 0) return { name: stem(file), group: [], file: null };
  return { name: rest[rest.length - 1], group: rest.slice(0, -1), file: ctx.sameFile ? null : file };
}

// 記事一覧を、見出し（group）が同じで連続するものごとにまとめる（並びは保つ）
export function groupArticles<T extends { path: string }>(
  list: T[],
): { group: string[]; items: (T & { label: ArticleLabel })[] }[] {
  const ctx = articleContext(list.map((a) => a.path));
  const out: { group: string[]; items: (T & { label: ArticleLabel })[] }[] = [];
  for (const a of list) {
    const label = articleLabel(a.path, ctx);
    const key = label.group.join("/");
    const last = out[out.length - 1];
    if (last && last.group.join("/") === key) last.items.push({ ...a, label });
    else out.push({ group: label.group, items: [{ ...a, label }] });
  }
  return out;
}
