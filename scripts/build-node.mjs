// Script de build para produção em Node.js puro (sem Cloudflare Workers).
//
// Uso:
//   bun run build:node
//   # ou
//   node scripts/build-node.mjs
//
// O que faz:
//   1. Roda `vite build` usando vite.config.node.ts (target node-server).
//   2. Copia o servidor HTTP standalone (server/node-server.mjs) para
//      dist/server/index.mjs.
//
// Resultado: você pode iniciar o servidor com:
//   node dist/server/index.mjs

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: false });
  if (result.status !== 0) {
    console.error(`\n[build-node] Falhou: ${cmd} ${args.join(" ")}`);
    process.exit(result.status || 1);
  }
}

// 1) Build com config Node
const viteBin = path.join(ROOT, "node_modules", ".bin", "vite");
const viteCmd = fs.existsSync(viteBin) ? viteBin : "npx";
const viteArgs = fs.existsSync(viteBin)
  ? ["build", "--config", "vite.config.node.ts"]
  : ["vite", "build", "--config", "vite.config.node.ts"];

run(viteCmd, viteArgs);

// 2) Verifica se dist/server/server.js foi gerado
const distServerDir = path.join(ROOT, "dist", "server");
const ssrEntry = path.join(distServerDir, "server.js");
if (!fs.existsSync(ssrEntry)) {
  console.error(`[build-node] Esperava ${ssrEntry} após o build, mas não foi encontrado.`);
  console.error(`[build-node] Conteúdo de dist/server:`);
  if (fs.existsSync(distServerDir)) {
    for (const f of fs.readdirSync(distServerDir)) console.error(`  - ${f}`);
  } else {
    console.error(`  (diretório não existe)`);
  }
  process.exit(1);
}

// 3) Copia o wrapper HTTP para dist/server/index.mjs
const src = path.join(ROOT, "server", "node-server.mjs");
const dest = path.join(distServerDir, "index.mjs");
fs.copyFileSync(src, dest);
console.log(`\n[build-node] Servidor Node copiado para ${dest}`);

console.log(`\n[build-node] Pronto! Inicie com:`);
console.log(`  node dist/server/index.mjs`);
console.log(`  PORT=3000 HOST=0.0.0.0 node dist/server/index.mjs`);
