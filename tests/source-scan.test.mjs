import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);

function read(path) {
  return readFileSync(new URL(path, root), "utf8");
}

function walk(dir, found) {
  readdirSync(dir).forEach((name) => {
    const full = join(dir, name);
    if (name === ".git" || name === "node_modules") return;
    if (statSync(full).isDirectory()) walk(full, found);
    else found.push(full);
  });
  return found;
}

function extract(html, tag) {
  const matches = html.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "g"));
  assert.equal(matches && matches.length, 1, tag);
  const inner = matches[0].match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
  return inner[1];
}

function cspHash(text) {
  return "sha256-" + createHash("sha256").update(text).digest("base64");
}

test("published callback script matches the source and its CSP hash", () => {
  const html = read("site/callback/index.html");
  const script = extract(html, "script");
  const style = extract(html, "style");
  assert.equal(script.trim(), read("src/callback.js").trim());
  assert.equal(html.includes("\r"), false);
  assert.equal(html.includes(cspHash(script)), true);
  assert.equal(html.includes(cspHash(style)), true);
  assert.equal(html.includes("unsafe-inline"), false);
  assert.equal(html.includes("https://"), false);
  assert.equal(html.includes("http://"), false);
  assert.equal(html.includes('name="referrer" content="no-referrer"'), true);
  assert.equal(html.includes("connect-src 'none'"), true);
  assert.equal(html.includes("history.replaceState"), true);
  const boot = script.slice(script.indexOf("function boot"));
  assert.equal(boot.includes("replaceState"), true);
  assert.equal(boot.indexOf("replaceState") < boot.indexOf("schedulePaint"), true);
  assert.equal(boot.includes("textContent"), false);
});

test("static pages do not load third-party resources or scripts", () => {
  ["site/index.html", "site/privacy/index.html", "site/404.html"].forEach((file) => {
    const html = read(file);
    assert.equal(html.includes("<script"), false, file);
    assert.equal(html.includes("unsafe-inline"), false, file);
    assert.equal(html.includes('name="referrer" content="no-referrer"'), true, file);
    assert.equal(html.includes("script-src 'none'"), true, file);
    assert.equal(html.includes("@import"), false, file);
    assert.equal(html.includes("fonts.googleapis"), false, file);
    assert.equal(html.includes("googletagmanager"), false, file);
  });
  const css = read("site/assets/site.css");
  assert.equal(css.includes("url("), false);
  assert.equal(css.includes("@import"), false);
  assert.equal(css.includes("http"), false);
  const notFound = read("site/404.html");
  assert.equal(notFound.includes(cspHash(extract(notFound, "style"))), true);
  assert.equal(notFound.includes('href="/pulse-whoop/privacy/"'), true);
  assert.equal(notFound.includes('href="/pulse-whoop/callback/"'), true);
});

test("the public site does not contain the local practice page or a credential form", () => {
  const files = walk(new URL("site/", root).pathname, []);
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.equal(combined.includes("local-test-code"), false);
  assert.equal(combined.includes("unsafe-inline"), false);
  assert.equal(combined.includes("<input"), false);
  assert.equal(combined.includes("<form"), false);
  assert.equal(combined.includes("manual-initiator"), false);
  const initiator = read("tests/manual-initiator.html");
  assert.equal(initiator.includes('type="button"'), true);
  assert.equal(initiator.includes("<input"), false);
  assert.equal(initiator.includes("local-test-code"), true);
  assert.equal(initiator.includes("buf[index] >= 248"), true);
  assert.equal(initiator.includes("Math.random"), false);
});

test("callback source has no network, storage, or HTML injection sinks", () => {
  const source = read("src/callback.js");
  const banned = [
    "fetch(",
    "XMLHttpRequest",
    "sendBeacon",
    "WebSocket",
    "postMessage",
    "indexedDB",
    "localStorage",
    "document.cookie",
    "innerHTML",
    "outerHTML",
    "document.write",
    "insertAdjacentHTML",
    "eval(",
    "new Function",
    "setItem",
    "location.assign",
    "location.replace",
    "location.href",
    "window.open",
    "console.",
    "Math.random",
    "getRandomValues"
  ];
  banned.forEach((needle) => {
    assert.equal(source.includes(needle), false, needle);
  });
  assert.equal(source.includes("removeItem"), true);
  assert.equal(source.includes("getItem"), true);
});

test("workflow publishes only site/ and keeps the token least-privilege", () => {
  const workflow = read(".github/workflows/pages.yml");
  assert.equal(workflow.includes("contents: read"), true);
  assert.equal(workflow.includes("contents: write"), false);
  assert.equal(workflow.includes("pages: write"), true);
  assert.equal(workflow.includes("id-token: write"), true);
  assert.equal(workflow.includes("persist-credentials: false"), true);
  assert.equal(workflow.includes("path: site"), true);
  assert.equal(workflow.includes("include-hidden-files: true"), true);
  assert.equal(workflow.includes("pull_request:"), false);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/deploy-pages@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/upload-pages-artifact@[0-9a-f]{40}/);
});

test("repository files do not contain live credentials or contact addresses", () => {
  const files = ["site", "src", "README.md", ".github"].flatMap((entry) => {
    const full = join(root.pathname, entry);
    return statSync(full).isDirectory() ? walk(full, []) : [full];
  });
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  files.forEach((file) => {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes("BEGIN PRIVATE KEY"), false, file);
    assert.equal(text.includes("ghp_"), false, file);
    assert.equal(text.includes("github_pat_"), false, file);
    assert.equal(/client_secret\s*[:=]\s*['"][A-Za-z0-9_-]{8,}['"]/.test(text), false, file);
    assert.equal(email.test(text), false, relative(root.pathname, file));
  });
});
