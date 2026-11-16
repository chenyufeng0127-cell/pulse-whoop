import assert from "node:assert/strict";
import test from "node:test";
import { launchChrome, openPage, requestHosts } from "./cdp-browser.mjs";
import { startServer } from "./static-server.mjs";

const CODE = "TESTCODE_DO_NOT_KEEP";
const TOKEN = "TESTTOKEN_DO_NOT_KEEP";
const SECRET = "TESTSECRET_DO_NOT_KEEP";
const STATE = "Abcd1234";
const OTHER = "Zzzzzzz1";
const STORAGE_KEY = "pulse_whoop_oauth_expected_state";

function snapshotExpression(secrets) {
  return `(() => {
    const secrets = ${JSON.stringify(secrets)};
    const html = document.documentElement.outerHTML;
    const local = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      local.push(key + "=" + localStorage.getItem(key));
    }
    const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
    const blob = [location.href, html, local.join("\\n"), document.cookie, resources.join("\\n")].join("\\n");
    const text = document.body.innerText;
    return {
      outcome: document.documentElement.getAttribute("data-outcome"),
      stateCheck: document.documentElement.getAttribute("data-state-check"),
      marginTop: getComputedStyle(document.body).marginTop,
      hrefHasQuery: location.search !== "",
      hrefHasHash: location.hash !== "" && location.hash !== "#",
      leaked: secrets.some((secret) => blob.includes(secret)),
      hasPending: text.includes("尚未完成"),
      hasUnconnected: text.includes("仍未连接"),
      hasSuccessClaim: text.includes("授权成功"),
      hasDenied: text.includes("授权被拒绝"),
      hasDiagnosisLimit: text.includes("不是诊断"),
      hasNoCollection: text.includes("不收集健康数据")
    };
  })()`;
}

function allows(hosts) {
  return hosts.every((host) => host === "127.0.0.1" || host === "data" || host === "about" || host === "browser");
}

test("browser callback scrubs secrets, verifies only stored state, and stays on /pulse-whoop/", async (t) => {
  const server = await startServer();
  const chrome = await launchChrome();
  const page = await openPage(chrome.port);
  t.after(async () => {
    await page.close();
    await chrome.close();
    await server.close();
  });
  const origin = server.origin;

  async function visit(url, secrets) {
    const warmup = url.includes("/callback")
      ? origin + "/pulse-whoop/privacy/"
      : origin + "/pulse-whoop/callback/";
    await page.goto(warmup);
    await page.goto(url);
    const snap = await page.evaluate(snapshotExpression(secrets));
    return { snap, hosts: requestHosts(page.requests), requests: page.requests.slice() };
  }

  await page.goto(origin + "/pulse-whoop/callback/");
  await page.evaluate("sessionStorage.clear(); localStorage.clear();");

  const unverified = await visit(
    origin + "/pulse-whoop/callback/?code=" + CODE + "&state=" + STATE,
    [CODE]
  );
  assert.equal(unverified.snap.outcome, "unverified");
  assert.equal(unverified.snap.stateCheck, "unavailable");
  assert.equal(unverified.snap.hrefHasQuery, false);
  assert.equal(unverified.snap.hrefHasHash, false);
  assert.equal(unverified.snap.leaked, false);
  assert.equal(unverified.snap.marginTop, "0px");
  assert.equal(allows(unverified.hosts), true, unverified.hosts.join(","));
  const followUps = unverified.requests.filter((request) => {
    return request.type !== "Document" && !request.url.startsWith("data:");
  });
  assert.equal(followUps.length, 0);
  const refererLeak = unverified.requests.some((request) => {
    return request.type !== "Document" && (request.referer.includes(CODE) || request.url.includes(CODE));
  });
  assert.equal(refererLeak, false);

  const denied = await visit(
    origin + "/pulse-whoop/callback/?error=access_denied&error_description=" + SECRET + "&state=" + STATE,
    [SECRET, CODE]
  );
  assert.equal(denied.snap.outcome, "provider_error");
  assert.equal(denied.snap.leaked, false);
  assert.equal(denied.snap.hasDenied, true);
  assert.equal(allows(denied.hosts), true, denied.hosts.join(","));

  const fragment = await visit(
    origin + "/pulse-whoop/callback/#access_token=" + TOKEN,
    [TOKEN, CODE, SECRET]
  );
  assert.equal(fragment.snap.outcome, "rejected");
  assert.equal(fragment.snap.hrefHasHash, false);
  assert.equal(fragment.snap.leaked, false);

  const secretField = await visit(
    origin + "/pulse-whoop/callback/?code=" + CODE + "&client_secret=" + SECRET + "&state=" + STATE,
    [CODE, SECRET, TOKEN]
  );
  assert.equal(secretField.snap.outcome, "rejected");
  assert.equal(secretField.snap.leaked, false);
  assert.equal(secretField.snap.hrefHasQuery, false);

  await page.goto(origin + "/pulse-whoop/callback/");
  await page.evaluate("sessionStorage.setItem(" + JSON.stringify(STORAGE_KEY) + ", " + JSON.stringify(STATE) + ")");
  const matched = await visit(
    origin + "/pulse-whoop/callback/?code=" + CODE + "&state=" + STATE,
    [CODE, STATE]
  );
  assert.equal(matched.snap.outcome, "matched");
  assert.equal(matched.snap.stateCheck, "matched");
  assert.equal(matched.snap.leaked, false);
  assert.equal(matched.snap.hrefHasQuery, false);
  assert.equal(matched.snap.hasPending, true);
  assert.equal(matched.snap.hasUnconnected, true);
  assert.equal(matched.snap.hasSuccessClaim, false);
  const storedAfterMatch = await page.evaluate("sessionStorage.getItem(" + JSON.stringify(STORAGE_KEY) + ")");
  assert.equal(storedAfterMatch, null);

  await page.goto(origin + "/pulse-whoop/callback/");
  await page.evaluate("sessionStorage.setItem(" + JSON.stringify(STORAGE_KEY) + ", " + JSON.stringify(STATE) + ")");
  const mismatch = await visit(
    origin + "/pulse-whoop/callback/?code=" + CODE + "&state=" + OTHER,
    [CODE, STATE, OTHER]
  );
  assert.equal(mismatch.snap.outcome, "mismatch");
  assert.equal(mismatch.snap.leaked, false);
  assert.equal(await page.evaluate("sessionStorage.getItem(" + JSON.stringify(STORAGE_KEY) + ")"), null);

  await page.goto(origin + "/pulse-whoop/callback/");
  await page.evaluate("sessionStorage.setItem(" + JSON.stringify(STORAGE_KEY) + ", " + JSON.stringify(STATE) + ")");
  const idle = await visit(origin + "/pulse-whoop/callback/", [STATE, CODE]);
  assert.equal(idle.snap.outcome, "idle");
  assert.equal(idle.snap.leaked, false);
  assert.equal(await page.evaluate("sessionStorage.getItem(" + JSON.stringify(STORAGE_KEY) + ")"), STATE);

  const home = await visit(origin + "/pulse-whoop/", []);
  assert.equal(allows(home.hosts), true, home.hosts.join(","));
  const privacyHref = await page.evaluate("document.querySelector('a[href=\"privacy/\"]').href");
  assert.equal(privacyHref, origin + "/pulse-whoop/privacy/");
  const callbackHref = await page.evaluate("document.querySelector('a[href=\"callback/\"]').href");
  assert.equal(callbackHref, origin + "/pulse-whoop/callback/");

  const privacy = await visit(origin + "/pulse-whoop/privacy/", []);
  assert.equal(privacy.snap.hasDiagnosisLimit, true);
  assert.equal(privacy.snap.hasNoCollection, true);
  assert.equal(allows(privacy.hosts), true, privacy.hosts.join(","));
  const privacyRequests = privacy.requests.map((request) => request.url);
  assert.equal(privacyRequests.some((url) => url.includes("/pulse-whoop/assets/site.css")), true);
  assert.equal(privacyRequests.some((url) => url.includes("developer.whoop.com")), false);

  await page.goto(origin + "/tests/manual-initiator.html");
  await page.evaluateAndWait("document.getElementById('practice').click()", "/pulse-whoop/callback/");
  const practiced = await page.evaluate(snapshotExpression(["local-test-code"]));
  assert.equal(practiced.outcome, "matched");
  assert.equal(practiced.leaked, false);
  assert.equal(practiced.hrefHasQuery, false);
  assert.equal(practiced.hasPending, true);
  assert.equal(practiced.hasSuccessClaim, false);
});
