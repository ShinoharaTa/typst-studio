// vite build の後に、配信するテキストのファイルの .gz と .br を作る（studio は @fastify/static の preCompressed で返す）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const EXT = new Set([".js", ".mjs", ".css", ".html", ".svg", ".json", ".map"]);
// 小さいものは圧縮しても得が無い
const MIN_BYTES = 1024;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXT.has(path.extname(e.name))) yield p;
  }
}

let n = 0;
for (const file of walk(dist)) {
  const buf = fs.readFileSync(file);
  if (buf.length < MIN_BYTES) continue;
  fs.writeFileSync(`${file}.gz`, zlib.gzipSync(buf, { level: 9 }));
  fs.writeFileSync(
    `${file}.br`,
    zlib.brotliCompressSync(buf, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
    }),
  );
  n++;
}
console.log(`compressed ${n} files in ${path.relative(process.cwd(), dist) || "."}`);
