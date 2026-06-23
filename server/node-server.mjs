// Servidor HTTP Node.js standalone para o build SSR do TanStack Start.
//
// Como funciona:
//   1. O build SSR (Vite + tanstackStart target=node-server) gera um módulo
//      em dist/server/server.js que exporta `default = { fetch(request) }`.
//   2. Este arquivo expõe um servidor HTTP Node nativo que converte
//      IncomingMessage/ServerResponse <-> Request/Response (Web Fetch API)
//      e delega para esse handler.
//   3. Também serve os assets estáticos gerados em dist/client.
//
// Uso em produção:
//   node dist/server/index.mjs
//   PORT=8080 HOST=0.0.0.0 node dist/server/index.mjs
//
// Compatível com PM2:
//   pm2 start dist/server/index.mjs --name app

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Resolução de caminhos
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist/server/index.mjs  ->  dist/
const DIST_DIR = path.resolve(__dirname, "..");
const CLIENT_DIR = path.join(DIST_DIR, "client");
const SERVER_ENTRY = path.join(__dirname, "server.js");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// ---------------------------------------------------------------------------
// MIME types básicos para assets estáticos
// ---------------------------------------------------------------------------
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Conversão IncomingMessage -> Request (Web Fetch API)
// ---------------------------------------------------------------------------
function nodeRequestToWebRequest(req) {
  const proto =
    req.headers["x-forwarded-proto"] || (req.socket && req.socket.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host || `${HOST}:${PORT}`;
  const url = `${proto}://${host}${req.url}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, String(value));
    }
  }

  const init = { method: req.method, headers };

  // Body apenas em métodos que aceitam corpo
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = new ReadableStream({
      start(controller) {
        req.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
        req.on("end", () => controller.close());
        req.on("error", (err) => controller.error(err));
      },
    });
    // Necessário no Node fetch para streams em request body
    init.duplex = "half";
  }

  return new Request(url, init);
}

// ---------------------------------------------------------------------------
// Envio de Response (Web) para ServerResponse (Node)
// ---------------------------------------------------------------------------
async function sendWebResponse(webResponse, res) {
  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!webResponse.body) {
    res.end();
    return;
  }

  const reader = webResponse.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

// ---------------------------------------------------------------------------
// Serve assets estáticos de dist/client
// ---------------------------------------------------------------------------
function serveStatic(req, res) {
  // Apenas GET/HEAD para assets
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);

  // Bloqueia path traversal
  if (pathname.includes("..")) return false;

  const filePath = path.join(CLIENT_DIR, pathname);
  if (!filePath.startsWith(CLIENT_DIR)) return false;

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  res.statusCode = 200;
  res.setHeader("Content-Type", getMimeType(filePath));
  res.setHeader("Content-Length", stat.size);

  // Cache longo para arquivos com hash (Vite usa /assets/*-[hash].ext)
  if (pathname.startsWith("/assets/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function start() {
  if (!fs.existsSync(SERVER_ENTRY)) {
    console.error(`[server] Entry SSR não encontrado em ${SERVER_ENTRY}`);
    console.error(`[server] Rode "bun run build" antes de iniciar o servidor.`);
    process.exit(1);
  }

  // Importa o handler SSR gerado pelo build
  const mod = await import(pathToFileURL(SERVER_ENTRY).href);
  const handler = mod.default;
  if (!handler || typeof handler.fetch !== "function") {
    console.error(`[server] ${SERVER_ENTRY} não exporta default.fetch()`);
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    try {
      // 1) Tenta servir asset estático
      if (serveStatic(req, res)) return;

      // 2) Caso contrário, delega ao handler SSR
      const webRequest = nodeRequestToWebRequest(req);
      const webResponse = await handler.fetch(webRequest);
      await sendWebResponse(webResponse, res);
    } catch (err) {
      console.error("[server] Erro ao processar requisição:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      res.end("Internal Server Error");
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[server] TanStack Start SSR rodando`);
    console.log(`[server]   -> http://${HOST}:${PORT}`);
    console.log(`[server]   client dir: ${CLIENT_DIR}`);
    console.log(`[server]   server entry: ${SERVER_ENTRY}`);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`[server] Recebido ${signal}, encerrando...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("[server] Falha ao iniciar:", err);
  process.exit(1);
});
