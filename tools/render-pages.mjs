import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "site/assets/site.css"), "utf8").trim();
const js = readFileSync(join(root, "src/callback.js"), "utf8").trim();
const styleInner = "\n" + css + "\n";
const scriptInner = "\n" + js + "\n";

function hash(text) {
  return "sha256-" + createHash("sha256").update(text).digest("base64");
}

const styleHash = hash(styleInner);
const scriptHash = hash(scriptInner);
const shared = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "connect-src 'none'",
  "font-src 'none'",
  "manifest-src 'none'",
  "media-src 'none'",
  "img-src data:"
].join("; ");

const callbackCsp = shared + "; script-src '" + scriptHash + "'; style-src '" + styleHash + "'";
const plainCsp = shared + "; script-src 'none'; style-src '" + styleHash + "'";

function fill(shell, replacements) {
  var html = shell;
  Object.keys(replacements).forEach(function (key) {
    if (!html.includes(key)) throw new Error("missing placeholder " + key);
    html = html.split(key).join(replacements[key]);
  });
  ["__STYLE__", "__SCRIPT__", "__CSP__"].forEach(function (key) {
    if (html.includes(key)) throw new Error("unreplaced placeholder " + key);
  });
  return html.endsWith("\n") ? html : html + "\n";
}

const callback = fill(readFileSync(join(root, "src/callback-shell.html"), "utf8"), {
  __STYLE__: styleInner,
  __SCRIPT__: scriptInner,
  __CSP__: callbackCsp
});
const notFound = fill(readFileSync(join(root, "src/not-found-shell.html"), "utf8"), {
  __STYLE__: styleInner,
  __CSP__: plainCsp
});

mkdirSync(join(root, "site/callback"), { recursive: true });
writeFileSync(join(root, "site/callback/index.html"), callback);
writeFileSync(join(root, "site/404.html"), notFound);
