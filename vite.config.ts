import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** 和桌面版同一条内容安全策略（tauri.conf.json）。`vite preview` 带上它，方便在浏览器里验证构建产物在 CSP 下能正常工作 */
const conf = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const csp = Object.entries(conf.app.security.csp as Record<string, string>).map(([k, v]) => `${k} ${v}`).join("; ");

// Tauri 开发时固定端口；构建产物给 Tauri 打包
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  preview: { port: 1421, headers: { "Content-Security-Policy": csp } },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "safari15", outDir: "dist", chunkSizeWarningLimit: 4000 },
});
