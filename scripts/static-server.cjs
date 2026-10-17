// Minimal static server for the browser regression scripts: they need a real
// http origin for IndexedDB, and the suite should not depend on a separately
// started preview process.
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

async function start(port = 8765) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const target = path.resolve(ROOT, "." + decodeURIComponent(url.pathname));
      const stat = await fsp.stat(target).catch(() => null);
      if (!stat?.isFile() || !target.startsWith(ROOT)) {
        response.writeHead(404).end("not found");
        return;
      }
      response.writeHead(200, { "Content-Type": MIME[path.extname(target)] || "application/octet-stream" });
      fs.createReadStream(target).pipe(response);
    } catch {
      response.writeHead(500).end("error");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

module.exports = { start, ROOT };
