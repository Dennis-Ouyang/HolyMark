import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 开发时固定端口；构建产物给 Tauri 打包
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "safari15", outDir: "dist", chunkSizeWarningLimit: 4000 },
});
