import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/callback.js", import.meta.url), "utf8");
const CODE = "TESTCODE_DO_NOT_KEEP";
const TOKEN = "TESTTOKEN_DO_NOT_KEEP";
const SECRET = "TESTSECRET_DO_NOT_KEEP";
const STATE = "Abcd1234";
const OTHER = "Zzzzzzz1";

function loadApi() {
  const sandbox = { __OAUTH_CALLBACK_TEST__: true };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "callback.js" });
  return sandbox.__oauthCallback;
}

const api = loadApi();

function classify(search, hash, expectedState, storageError) {
  return api.handleAuthorizationCallback({
    search,
    hash: hash || "",
    expectedState: expectedState === undefined ? null : expectedState,
    storageError: storageError === true
  });
}

function assertClean(value, secrets) {
  const blob = JSON.stringify(value);
  secrets.forEach((secret) => {
    assert.equal(blob.includes(secret), false);
  });
  assert.equal(Object.hasOwn(value, "code"), false);
  assert.equal(Object.hasOwn(value, "search"), false);
  assert.equal(Object.hasOwn(value, "hash"), false);
}

function element(doc) {
  const el = {
    className: "",
    attrs: {},
    children: [],
    focused: false,
    ownerDocument: doc,
    _text: "",
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    },
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join("");
    },
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    getAttribute(key) {
      return Object.hasOwn(this.attrs, key) ? this.attrs[key] : null;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      return child;
    },
    get firstChild() {
      return this.children[0] || null;
    },
    focus() {
      this.focused = true;
    }
  };
  return el;
}

function makeWindow(options) {
  const store = new Map(Object.entries(options.storage || {}));
  const removed = [];
  const nodes = {};
  const doc = {
    readyState: options.readyState || "complete",
    listeners: [],
    documentElement: null,
    getElementById(id) {
      return nodes[id] || null;
    },
    createElement() {
      const created = element(doc);
      created.ownerDocument = doc;
      return created;
    },
    addEventListener(name, fn) {
      this.listeners.push({ name, fn });
    }
  };
  doc.documentElement = element(doc);
  ["status", "status-title", "status-kicker", "status-body"].forEach((id) => {
    nodes[id] = element(doc);
  });
  const location = {
    pathname: "/pulse-whoop/callback/",
    search: options.search || "",
    hash: options.hash || ""
  };
  const calls = [];
  const win = {
    location,
    history: {
      replaceState(_state, _title, url) {
        if (options.failScrub) throw new Error("replace failed");
        calls.push(url);
        location.search = "";
        location.hash = "";
      }
    },
    sessionStorage: {
      getItem(key) {
        if (options.storageThrows) throw new Error("storage blocked");
        return store.has(key) ? store.get(key) : null;
      },
      setItem() {
        throw new Error("sessionStorage.setItem was called");
      },
      removeItem(key) {
        removed.push(key);
        store.delete(key);
      }
    },
    document: doc
  };
  return { win, calls, store, removed, doc };
}

test("exports the classifier without booting a document", () => {
  assert.equal(typeof api.handleAuthorizationCallback, "function");
  assert.equal(api.EXPECTED_STATE_KEY, "pulse_whoop_oauth_expected_state");
  assert.equal(source.includes("setItem"), false);
  assert.equal(source.includes("getRandomValues"), false);
  assert.equal(source.includes("localStorage"), false);
});

test("direct visit is idle and does not consume an expected state", () => {
  const result = classify("", "");
  assert.equal(result.outcome, "idle");
  assert.equal(result.stateCheck, "not_applicable");
  assert.equal(result.consumeExpected, false);
  const page = makeWindow({ storage: { [api.EXPECTED_STATE_KEY]: STATE }, search: "" });
  api.boot(page.win);
  assert.deepEqual(page.calls, ["/pulse-whoop/callback/"]);
  assert.deepEqual(page.removed, []);
  assert.equal(page.store.get(api.EXPECTED_STATE_KEY), STATE);
  assert.equal(page.doc.documentElement.getAttribute("data-outcome"), "idle");
  assert.equal(page.doc.getElementById("status-body").textContent.includes(STATE), false);
});

test("an authorization code without a stored state is not verified", () => {
  const result = classify("?code=" + CODE + "&state=" + STATE, "", null);
  assert.equal(result.outcome, "unverified");
  assert.equal(result.stateCheck, "unavailable");
  assert.equal(result.consumeExpected, true);
  assert.equal(result.title.includes("未能核对"), true);
  assertClean(result, [CODE, STATE]);
});

test("matching eight-character state is recognized and still not a connection", () => {
  const result = classify("?code=" + CODE + "&state=" + STATE, "", STATE);
  assert.equal(result.outcome, "matched");
  assert.equal(result.stateCheck, "matched");
  assert.equal(result.title.includes("尚未完成"), true);
  assert.equal(JSON.stringify(result).includes("授权成功"), false);
  assertClean(result, [CODE]);
});

test("equal values are not verified when they are not eight alphanumeric characters", () => {
  const wide = "一二三四五六七八";
  const result = classify("?code=" + CODE + "&state=" + encodeURIComponent(wide), "", wide);
  assert.equal(result.outcome, "unverified");
  assert.equal(result.stateCheck, "unavailable");
  assertClean(result, [CODE, wide]);
});

test("a different stored state is a mismatch and is consumed", () => {
  const page = makeWindow({
    storage: { [api.EXPECTED_STATE_KEY]: STATE },
    search: "?code=" + CODE + "&state=" + OTHER
  });
  api.boot(page.win);
  assert.equal(page.doc.documentElement.getAttribute("data-outcome"), "mismatch");
  assert.equal(page.doc.documentElement.getAttribute("data-state-check"), "mismatch");
  assert.deepEqual(page.removed, [api.EXPECTED_STATE_KEY]);
  assert.equal(page.store.has(api.EXPECTED_STATE_KEY), false);
  const text = page.doc.getElementById("status-body").textContent;
  assert.equal(text.includes(CODE), false);
  assert.equal(text.includes(STATE), false);
  assert.equal(text.includes(OTHER), false);
});

test("state comparison is case sensitive", () => {
  const result = classify("?code=" + CODE + "&state=abcd1234", "", STATE);
  assert.equal(result.outcome, "mismatch");
  assertClean(result, [CODE]);
});

test("provider errors stay generic and do not echo descriptions", () => {
  const result = classify(
    "?error=access_denied&error_description=" + SECRET + "&error_uri=https://evil.example/" + SECRET + "&state=" + STATE,
    "",
    null
  );
  assert.equal(result.outcome, "provider_error");
  assert.equal(result.stateCheck, "unavailable");
  assert.equal(result.paragraphs[0].includes("授权被拒绝"), true);
  assertClean(result, [SECRET, "evil.example"]);
});

test("unknown provider error text is not rendered", () => {
  const result = classify("?error=" + SECRET + "&state=" + STATE, "", STATE);
  assert.equal(result.outcome, "provider_error");
  assert.equal(result.stateCheck, "matched");
  assert.equal(result.paragraphs.join("").includes(SECRET), false);
  assert.equal(result.paragraphs.join("").includes("返回了错误"), true);
  assertClean(result, [SECRET]);
});

test("tokens, secrets, fragments, and mixed responses are rejected", () => {
  const cases = [
    "?code=" + CODE + "&client_secret=" + SECRET + "&state=" + STATE,
    "?code=" + CODE + "&access_token=" + TOKEN + "&state=" + STATE,
    "?refresh_token=" + TOKEN,
    "?code=" + CODE + "&state=" + STATE + "&extra=1",
    "?code=" + CODE + "&code=" + SECRET + "&state=" + STATE,
    "?code=&state=" + STATE,
    "?error=&state=" + STATE,
    "?code=" + CODE + "&error=access_denied&state=" + STATE,
    "?Code=" + CODE + "&state=" + STATE
  ];
  cases.forEach((search) => {
    const result = classify(search, "", STATE);
    assert.equal(result.outcome, "rejected", search);
    assert.equal(result.stateCheck, "not_applicable");
    assertClean(result, [CODE, TOKEN, SECRET]);
  });
  const fragmented = classify("?code=" + CODE + "&state=" + STATE, "#access_token=" + TOKEN, STATE);
  assert.equal(fragmented.outcome, "rejected");
  assert.notEqual(fragmented.outcome, "matched");
  assertClean(fragmented, [CODE, TOKEN, STATE]);
});

test("malformed or oversized responses are rejected without echoing them", () => {
  const broken = classify("?code=%E0%A4%A&state=" + STATE, "", null);
  assert.equal(broken.outcome, "rejected");
  assertClean(broken, ["%E0", CODE]);
  const huge = "?" + "a".repeat(5000) + CODE;
  const oversized = classify(huge, "", null);
  assert.equal(oversized.outcome, "rejected");
  assertClean(oversized, [CODE]);
});

test("address bar is scrubbed before render and secrets are not stored", () => {
  const page = makeWindow({
    readyState: "loading",
    search: "?code=" + CODE + "&state=" + STATE,
    hash: "#access_token=" + TOKEN
  });
  api.boot(page.win);
  assert.deepEqual(page.calls, ["/pulse-whoop/callback/"]);
  assert.equal(page.win.location.search, "");
  assert.equal(page.win.location.hash, "");
  assert.equal(page.doc.documentElement.getAttribute("data-booted"), null);
  page.doc.listeners[0].fn();
  assert.equal(page.doc.documentElement.getAttribute("data-outcome"), "rejected");
  const text = page.doc.getElementById("status").textContent;
  assert.equal(text.includes(CODE), false);
  assert.equal(text.includes(TOKEN), false);
  assert.equal(page.doc.getElementById("status-title").focused, true);
});

test("a failed scrub tells the visitor not to copy the address", () => {
  const page = makeWindow({
    search: "?code=" + CODE + "&state=" + STATE,
    failScrub: true
  });
  api.boot(page.win);
  assert.equal(page.doc.documentElement.getAttribute("data-outcome"), "scrub_failed");
  const text = page.doc.getElementById("status-body").textContent;
  assert.equal(text.includes("不要复制"), true);
  assert.equal(text.includes(CODE), false);
});

test("blocked sessionStorage cannot verify a returned state", () => {
  const page = makeWindow({
    storageThrows: true,
    search: "?code=" + CODE + "&state=" + STATE
  });
  api.boot(page.win);
  assert.equal(page.doc.documentElement.getAttribute("data-outcome"), "unverified");
  assert.equal(page.doc.documentElement.getAttribute("data-state-check"), "unavailable");
  assert.deepEqual(page.removed, []);
  assert.equal(page.doc.getElementById("status-body").textContent.includes(CODE), false);
});
