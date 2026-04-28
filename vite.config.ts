import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/widget/",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  plugins: [react()],
  build: {
    cssCodeSplit: false,
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/main.tsx"),
      name: "BungeeWidget",
      formats: ["iife"],
      fileName: () => "widget.js"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});
