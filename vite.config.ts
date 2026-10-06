import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth"],
          vendor: ["react", "react-dom"],
          validation: ["zod"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:5181" },
  },
  test: { exclude: ["**/node_modules/**", "**/dist/**", "**/*.emulator.ts"] },
} as any);
