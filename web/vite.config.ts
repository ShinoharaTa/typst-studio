import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 本番は studio サーバーが web/dist を / で配信する。
// npm run dev -w web は studio（既定 127.0.0.1:8796）へ /api と /preview を中継する
// （tinymist の WebSocket はルート / に張られるので、記事プレビューは dev では動かない）
const studio = process.env.STUDIO_URL ?? "http://127.0.0.1:8796";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // pdf.js と CodeMirror で大きくなる
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": { target: studio, ws: true, changeOrigin: false },
      "/preview": { target: studio },
    },
  },
});
