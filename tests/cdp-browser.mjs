import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";

function hostnameOf(url) {
  if (url.startsWith("data:")) return "data";
  if (url.startsWith("about:")) return "about";
  if (url.startsWith("blob:")) return "blob";
  if (url.startsWith("chrome:") || url.startsWith("devtools:")) return "browser";
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid";
  }
}

export async function launchChrome() {
  const profile = await mkdtemp(join(tmpdir(), "pulse-whoop-chrome-"));
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
    "--disable-extensions",
    "--disable-default-apps",
    "--no-first-run",
    "--no-default-browser-check",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-pings",
    "--disable-features=Translate,OptimizationHints,MediaRouter",
    "--remote-allow-origins=*",
    "--user-data-dir=" + profile,
    "--remote-debugging-port=0",
    "about:blank"
  ];
  const proc = spawn(chromePath, args, { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not open a debugging port")), 20000);
    function onData(chunk) {
      log += chunk.toString();
      const match = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    }
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("Chrome exited early (" + code + ")"));
    });
  });
  return {
    port,
    async close() {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* The browser may already have exited. */
      }
      proc.stdout.destroy();
      proc.stderr.destroy();
      proc.unref();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
    }
  };
}

async function createTarget(port) {
  const endpoint = "http://127.0.0.1:" + port + "/json/new?" + encodeURIComponent("about:blank");
  let response = await fetch(endpoint, { method: "PUT" });
  if (!response.ok) response = await fetch(endpoint, { method: "GET" });
  if (!response.ok) throw new Error("unable to open a Chrome tab");
  return response.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.listeners = [];
    this.requests = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error("cdp command failed"));
        else waiter.resolve(message.result);
      } else if (message.method) {
        if (message.method === "Network.requestWillBeSent") {
          const request = message.params.request;
          this.requests.push({
            url: request.url,
            type: message.params.type,
            referer: request.headers.Referer || request.headers.referer || ""
          });
        }
        this.listeners.forEach((listener) => listener(message));
      }
    });
  }

  send(method, params) {
    const id = this.next;
    this.next += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("cdp timeout: " + method));
      }, 15000);
      this.pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        }
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  waitFor(method) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((item) => item !== onEvent);
        reject(new Error("timed out waiting for " + method));
      }, 15000);
      const onEvent = (message) => {
        if (message.method !== method) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((item) => item !== onEvent);
        resolve(message.params || {});
      };
      this.listeners.push(onEvent);
    });
  }
}

export async function openPage(port) {
  const target = await createTarget(port);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("devtools socket failed")), { once: true });
  });
  const client = new Cdp(ws);
  await client.send("Page.enable");
  await client.send("Network.enable");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  await client.send("Runtime.enable");
  async function waitForPath(pathname) {
    const started = Date.now();
    while (Date.now() - started < 10000) {
      try {
        const result = await client.send("Runtime.evaluate", {
          expression: "document.readyState + '\\n' + location.pathname",
          returnByValue: true
        });
        const value = result && result.result ? result.result.value : "";
        if (value === "complete\n" + pathname) return;
      } catch {
        /* The page context is replaced during navigation. */
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error("navigation did not finish");
  }

  return {
    requests: client.requests,
    async goto(url) {
      client.requests.length = 0;
      const pathname = new URL(url).pathname;
      const result = await client.send("Page.navigate", { url });
      if (result && result.errorText) throw new Error("navigation failed");
      await waitForPath(pathname);
    },
    async evaluate(expression) {
      const result = await client.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (!result || !result.result || result.result.subtype === "error" || result.exceptionDetails) {
        throw new Error("page script failed");
      }
      return result.result.value;
    },
    async evaluateAndWait(expression, pathname) {
      await client.send("Runtime.evaluate", {
        expression,
        returnByValue: true
      }).catch(() => {});
      await waitForPath(pathname);
    },
    async close() {
      ws.close();
      await fetch("http://127.0.0.1:" + port + "/json/close/" + target.id, { method: "GET" }).catch(() => {});
    }
  };
}

export function requestHosts(requests) {
  return [...new Set(requests.map((request) => hostnameOf(request.url)))];
}
