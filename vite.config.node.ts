// Config alternativa para build em Node.js puro (sem Cloudflare Workers).
// Use APENAS no servidor de produção:
//   bunx vite build --config vite.config.node.ts
//   node .output/server/index.mjs
//
// Não use em desenvolvimento no Lovable — o preview do Lovable depende do
// preset padrão (vite.config.ts).
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({
      target: "node-server", // <- chave: build para Node, não para Workers
    }),
    viteReact(),
  ],
});
