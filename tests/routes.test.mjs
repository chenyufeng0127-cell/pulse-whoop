import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "./static-server.mjs";

const CODE = "TESTCODE_DO_NOT_KEEP";

test("project paths serve the static pages and do not reflect the OAuth query", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const origin = server.origin;

  async function bodyOf(path, status) {
    const response = await fetch(origin + path);
    assert.equal(response.status, status, path);
    return response.text();
  }

  const home = await bodyOf("/pulse-whoop/", 200);
  assert.equal(home.includes("个人 WHOOP 数据助手"), true);
  assert.equal(home.includes('href="privacy/"'), true);
  assert.equal(home.includes('href="callback/"'), true);

  const privacy = await bodyOf("/pulse-whoop/privacy/", 200);
  assert.equal(privacy.includes("不收集健康数据"), true);
  assert.equal(privacy.includes("read:recovery"), true);
  assert.equal(privacy.includes("read:cycles"), true);
  assert.equal(privacy.includes("read:sleep"), true);
  assert.equal(privacy.includes("read:workout"), true);
  assert.equal(privacy.includes("read:profile"), true);
  assert.equal(privacy.includes("不是诊断"), true);
  assert.equal(privacy.includes("其他助手代理"), true);
  assert.equal(privacy.includes("付费健康服务"), true);
  assert.equal(privacy.includes("Grok Bot"), true);
  assert.equal(privacy.includes("GitHub Pages"), true);

  const callback = await bodyOf("/pulse-whoop/callback/?code=" + CODE + "&state=Abcd1234", 200);
  assert.equal(callback.includes(CODE), false);
  assert.equal(callback.includes("history.replaceState"), true);
  assert.equal(callback.includes("Content-Security-Policy") || callback.includes("content-security-policy"), true);
  assert.equal(callback.includes("no-referrer"), true);

  const css = await fetch(origin + "/pulse-whoop/assets/site.css");
  assert.equal(css.status, 200);
  assert.equal((await css.text()).includes("color-scheme"), true);

  const missing = await bodyOf("/pulse-whoop/does-not-exist", 404);
  assert.equal(missing.includes("找不到这个路径"), true);
  assert.equal(missing.includes(CODE), false);

  const escaped = await bodyOf("/pulse-whoop/%2e%2e/%2e%2e/README.md", 404);
  assert.equal(escaped.includes("Deploy static content"), false);

  const slash = await fetch(origin + "/pulse-whoop", { redirect: "manual" });
  assert.equal(slash.status, 302);
  assert.equal(slash.headers.get("location"), "/pulse-whoop/");
});
