import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
const appPackage = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
export default defineConfig({
  define: {
    __AURE_VERSION__: JSON.stringify(appPackage.version),
    __AURE_BUILD_DATE__: JSON.stringify(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })),
  },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/resources/**", "**/references/**", "**/verification/**", "**/test-results/**", "**/playwright-report/**"] },
  },
  build: { target: "es2022", manifest: true, rollupOptions: { output: { manualChunks(id) {
    if (!id.includes('/node_modules/')) return;
    if (/\/node_modules\/(?:react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react-vendor';
    if (/\/node_modules\/(?:motion|motion-dom|motion-utils|framer-motion)\//.test(id)) return 'motion-vendor';
    if (id.includes('/node_modules/@radix-ui/') || id.includes('/node_modules/radix-ui/')) return 'ui-vendor';
  } } } },
});
