import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = join(root, "site");
const initiatorPath = join(root, "tests", "manual-initiator.html");

function contentType(file) {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function safeFile(base, relative) {
  const full = resolve(base, relative);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

async function sendFile(res, file, status) {
  const body = await readFile(file);
  res.writeHead(status, {
    "Content-Type": contentType(file),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  res.end(body);
}

async function sendNotFound(res) {
  try {
    await sendFile(res, join(siteRoot, "404.html"), 404);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
}

export function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let decoded = url.pathname;
      if (decoded.includes("\\") || decoded.includes("\0")) {
        await sendNotFound(res);
        return;
      }
      if (decoded === "/pulse-whoop") {
        res.writeHead(302, { Location: "/pulse-whoop/", "Referrer-Policy": "no-referrer" });
        res.end();
        return;
      }
      if (decoded === "/tests/manual-initiator.html") {
        await sendFile(res, initiatorPath, 200);
        return;
      }
      if (decoded !== "/pulse-whoop" && !decoded.startsWith("/pulse-whoop/")) {
        await sendNotFound(res);
        return;
      }
      let relative = decoded.slice("/pulse-whoop/".length);
      if (relative.includes("..")) {
        await sendNotFound(res);
        return;
      }
      if (relative === "" || relative.endsWith("/")) relative += "index.html";
      relative = normalize(relative);
      if (relative.startsWith("..") || relative.startsWith("/") || relative === ".") {
        await sendNotFound(res);
        return;
      }
      const file = safeFile(siteRoot, relative);
      if (!file) {
        await sendNotFound(res);
        return;
      }
      try {
        await sendFile(res, file, 200);
      } catch {
        await sendNotFound(res);
      }
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("bad request");
    }
  });

  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolveServer({
        port,
        origin: "http://127.0.0.1:" + port,
        close() {
          return new Promise((done) => server.close(() => done()));
        }
      });
    });
  });
}
