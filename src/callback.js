(function () {
  "use strict";

  var EXPECTED_STATE_KEY = "pulse_whoop_oauth_expected_state";
  var STATE_RE = /^[A-Za-z0-9]{8}$/;
  var MAX_COMPONENT = 4096;
  var MAX_PAIRS = 8;

  var OFFICIAL = {
    code: true,
    state: true,
    error: true,
    error_description: true,
    error_uri: true
  };

  var SENSITIVE = {
    access_token: true,
    refresh_token: true,
    id_token: true,
    client_secret: true,
    password: true,
    token: true
  };

  var SAFE_ERROR = {
    access_denied: "授权被拒绝，或你没有同意这次访问。",
    invalid_request: "授权请求无效。",
    unauthorized_client: "这个应用不能使用该授权方式。",
    unsupported_response_type: "返回的授权类型不受支持。",
    invalid_scope: "请求的权限范围无效。",
    server_error: "WHOOP 授权服务报告了服务器错误。",
    temporarily_unavailable: "WHOOP 授权服务暂时不可用。"
  };

  var OUTCOMES = {
    idle: true,
    matched: true,
    unverified: true,
    mismatch: true,
    provider_error: true,
    rejected: true,
    failure: true,
    scrub_failed: true
  };

  var CHECKS = {
    not_applicable: true,
    unavailable: true,
    matched: true,
    mismatch: true
  };

  var PANELS = {
    panel: true,
    "panel warn": true,
    "panel bad": true
  };

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function handoffNote() {
    return "授权码、访问令牌、刷新令牌和客户端密钥都不会留在本页，也不能贴进普通聊天。令牌交换要等你在自己的机密客户端里另行交接。";
  }

  function model(spec) {
    return {
      outcome: spec.outcome,
      stateCheck: spec.stateCheck,
      consumeExpected: spec.consumeExpected === true,
      panelClass: spec.panelClass,
      kicker: spec.kicker,
      title: spec.title,
      paragraphs: spec.paragraphs,
      notes: spec.notes || [handoffNote()]
    };
  }

  function idleModel() {
    return model({
      outcome: "idle",
      stateCheck: "not_applicable",
      consumeExpected: false,
      panelClass: "panel",
      kicker: "准备阶段",
      title: "授权回调尚未收到响应",
      paragraphs: [
        "这是个人 WHOOP 数据助手的静态回调页。现在的地址里没有授权响应。",
        "本页不收集密码、客户端密钥或健康数据，也不会向 WHOOP 交换令牌。仅打开此页不会连接账户。"
      ],
      notes: [
        "以后发起授权时，要先准备恰好 8 个字符的 state，并在离开本站前写入这个浏览器的 sessionStorage。没有事先保存的预期值时，返回的 state 不会被标成已核对。"
      ]
    });
  }

  function rejectedModel() {
    return model({
      outcome: "rejected",
      stateCheck: "not_applicable",
      consumeExpected: true,
      panelClass: "panel bad",
      kicker: "未连接",
      title: "这个响应不能使用",
      paragraphs: [
        "本页只接受 WHOOP 授权码流程放在查询参数中的结果：授权码和 state，或错误和 state。",
        "地址片段里的内容，以及访问令牌、刷新令牌、客户端密钥这类字段，都不会显示、保存或再发送。",
        "连接没有完成。这里没有填写这些秘密的表单。"
      ]
    });
  }

  function failureModel(consume) {
    return model({
      outcome: "failure",
      stateCheck: "unavailable",
      consumeExpected: consume === true,
      panelClass: "panel bad",
      kicker: "未连接",
      title: "无法安全处理这次响应",
      paragraphs: [
        "处理过程中出了问题。为避免泄露，页面不显示具体原因。请关闭这个标签，不要复制地址栏。"
      ]
    });
  }

  function scrubFailedModel() {
    return model({
      outcome: "scrub_failed",
      stateCheck: "not_applicable",
      consumeExpected: true,
      panelClass: "panel bad",
      kicker: "未连接",
      title: "请不要复制地址栏",
      paragraphs: [
        "无法从地址栏移除查询参数或片段。请不要复制、转发或保存这个地址，直接关闭标签。",
        "页面没有显示授权码、令牌或客户端密钥，也没有把它们再次发送出去。"
      ]
    });
  }

  function stateLine(stateCheck, storageError) {
    if (stateCheck === "matched") {
      return "返回的 state 与事先保存的预期值一致，但授权本身没有完成。";
    }
    if (stateCheck === "mismatch") {
      return "返回的 state 与事先保存的预期值不一致。";
    }
    if (storageError) {
      return "无法读取事先保存的 state，因此不能核对。";
    }
    return "没有可用的事先保存的 state，因此不能把这次返回值当成已核对。";
  }

  function providerErrorModel(error, stateCheck, storageError) {
    var lead = hasOwn(SAFE_ERROR, error)
      ? SAFE_ERROR[error]
      : "WHOOP 返回了错误，授权没有完成。";
    return model({
      outcome: "provider_error",
      stateCheck: stateCheck,
      consumeExpected: true,
      panelClass: "panel warn",
      kicker: "未连接",
      title: "授权没有完成",
      paragraphs: [
        lead,
        stateLine(stateCheck, storageError),
        "没有保存授权码或令牌。连接没有完成。"
      ]
    });
  }

  function receivedModel(stateCheck, storageError) {
    if (stateCheck === "matched") {
      return model({
        outcome: "matched",
        stateCheck: "matched",
        consumeExpected: true,
        panelClass: "panel",
        kicker: "未连接",
        title: "已收到授权响应，连接尚未完成",
        paragraphs: [
          "返回的 state 与这个浏览器在跳转前保存的 8 位预期值一致。",
          "WHOOP 账户仍未连接。本页没有换取访问令牌或刷新令牌。",
          "授权码没有写入页面、日志或浏览器存储，也没有被发到其他地址。"
        ]
      });
    }
    if (stateCheck === "mismatch") {
      return model({
        outcome: "mismatch",
        stateCheck: "mismatch",
        consumeExpected: true,
        panelClass: "panel bad",
        kicker: "未连接",
        title: "state 不一致，响应已丢弃",
        paragraphs: [
          "返回的 state 与这个浏览器事先保存的预期值不一致，或返回值不是 8 位字母数字。",
          "这次响应不能使用。授权码没有显示、保存或发送。连接没有完成。"
        ]
      });
    }
    return model({
      outcome: "unverified",
      stateCheck: "unavailable",
      consumeExpected: true,
      panelClass: "panel warn",
      kicker: "未连接",
      title: "已收到授权响应，但未能核对 state",
      paragraphs: [
        storageError
          ? "地址中有授权响应，但这个浏览器无法读取 sessionStorage，因此不能核对 state。"
          : "地址中有授权响应，但这个浏览器里没有可用的、事先保存的 8 位预期 state。",
        "没有事先保存的预期值时，本页不会把任意 state 当成已经核对。授权码没有显示、保存或发送。",
        "连接没有完成。"
      ]
    });
  }

  function stateCheckFor(expected, returned, storageError) {
    if (storageError) return "unavailable";
    if (typeof expected !== "string" || !STATE_RE.test(expected)) return "unavailable";
    if (typeof returned !== "string" || !STATE_RE.test(returned)) return "mismatch";
    if (expected === returned) return "matched";
    return "mismatch";
  }

  function parseForm(input) {
    if (typeof input !== "string") return { ok: false, pairs: [] };
    if (input.length > MAX_COMPONENT) return { ok: false, pairs: [] };
    var body = input;
    if (body.charAt(0) === "?" || body.charAt(0) === "#") body = body.slice(1);
    if (body === "") return { ok: true, pairs: [] };
    var parts = body.split("&");
    if (parts.length > MAX_PAIRS) return { ok: false, pairs: [] };
    var pairs = [];
    var index;
    for (index = 0; index < parts.length; index += 1) {
      var part = parts[index];
      if (part === "") return { ok: false, pairs: [] };
      var eq = part.indexOf("=");
      var rawName = eq === -1 ? part : part.slice(0, eq);
      var rawValue = eq === -1 ? "" : part.slice(eq + 1);
      var name;
      var value;
      try {
        name = decodeURIComponent(rawName.replace(/\+/g, " "));
        value = decodeURIComponent(rawValue.replace(/\+/g, " "));
      } catch (decodingError) {
        return { ok: false, pairs: [] };
      }
      pairs.push({ name: name, value: value });
    }
    return { ok: true, pairs: pairs };
  }

  function wipePairs(pairs) {
    var index;
    for (index = 0; index < pairs.length; index += 1) {
      pairs[index].name = "";
      pairs[index].value = "";
    }
  }

  function collect(pairs, name) {
    var values = [];
    var index;
    for (index = 0; index < pairs.length; index += 1) {
      if (pairs[index].name === name) values.push(pairs[index].value);
    }
    return values;
  }

  function namesAreOfficial(pairs) {
    var index;
    for (index = 0; index < pairs.length; index += 1) {
      var name = pairs[index].name;
      if (typeof name !== "string") return false;
      var lower = name.toLowerCase();
      if (hasOwn(SENSITIVE, lower)) return false;
      if (!hasOwn(OFFICIAL, name)) return false;
    }
    return true;
  }

  function handleAuthorizationCallback(input) {
    try {
      if (!input || typeof input.search !== "string" || typeof input.hash !== "string") {
        return failureModel(true);
      }
      var storageError = input.storageError === true;
      var expected = typeof input.expectedState === "string" ? input.expectedState : null;
      if (input.search.length > MAX_COMPONENT || input.hash.length > MAX_COMPONENT) {
        return rejectedModel();
      }
      var query = parseForm(input.search);
      var fragment = parseForm(input.hash);
      if (!query.ok || !fragment.ok) return rejectedModel();
      var fragmentPresent = input.hash !== "" && input.hash !== "#";
      if (fragmentPresent || fragment.pairs.length > 0) {
        wipePairs(query.pairs);
        wipePairs(fragment.pairs);
        return rejectedModel();
      }
      if (!namesAreOfficial(query.pairs)) {
        wipePairs(query.pairs);
        return rejectedModel();
      }

      var codes = collect(query.pairs, "code");
      var states = collect(query.pairs, "state");
      var errors = collect(query.pairs, "error");
      var codeValue = codes.length === 1 ? codes[0] : null;
      var returnedState = states.length === 1 ? states[0] : "";
      var errorValue = errors.length === 1 ? errors[0] : null;
      var stateCheck = stateCheckFor(expected, returnedState, storageError);
      var safeError = errorValue !== null && hasOwn(SAFE_ERROR, errorValue) ? errorValue : null;
      var hadEmptyCode = codeValue === "";
      var hadEmptyError = errorValue === "";
      var hadBoth = codeValue !== null && errorValue !== null;
      var hadCode = codeValue !== null && codeValue !== "";
      var hadError = errorValue !== null && errorValue !== "";
      var hadPairs = query.pairs.length > 0;
      var duplicate = codes.length > 1 || states.length > 1 || errors.length > 1;
      wipePairs(query.pairs);
      codes = [];
      states = [];
      errors = [];
      codeValue = null;
      returnedState = "";
      errorValue = null;

      if (duplicate || hadBoth || hadEmptyCode || hadEmptyError) return rejectedModel();
      if (hadError) return providerErrorModel(safeError, stateCheck, storageError);
      if (hadCode) return receivedModel(stateCheck, storageError);
      if (hadPairs) return rejectedModel();
      return idleModel();
    } catch (classificationError) {
      return failureModel(true);
    }
  }

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function render(doc, view) {
    var root = doc.getElementById("status");
    var title = doc.getElementById("status-title");
    var kicker = doc.getElementById("status-kicker");
    var body = doc.getElementById("status-body");
    if (!root || !title || !kicker || !body) return;
    var outcome = hasOwn(OUTCOMES, view.outcome) ? view.outcome : "failure";
    var stateCheck = hasOwn(CHECKS, view.stateCheck) ? view.stateCheck : "unavailable";
    var panelClass = hasOwn(PANELS, view.panelClass) ? view.panelClass : "panel";
    root.className = panelClass;
    root.setAttribute("data-outcome", outcome);
    root.setAttribute("data-state-check", stateCheck);
    doc.documentElement.setAttribute("data-booted", "1");
    doc.documentElement.setAttribute("data-outcome", outcome);
    doc.documentElement.setAttribute("data-state-check", stateCheck);
    kicker.textContent = view.kicker;
    title.textContent = view.title;
    clearChildren(body);
    var paragraphs = view.paragraphs || [];
    var index;
    for (index = 0; index < paragraphs.length; index += 1) {
      var paragraph = doc.createElement("p");
      paragraph.textContent = paragraphs[index];
      body.appendChild(paragraph);
    }
    var notes = view.notes || [];
    if (notes.length > 0) {
      var list = doc.createElement("ul");
      for (index = 0; index < notes.length; index += 1) {
        var item = doc.createElement("li");
        item.textContent = notes[index];
        list.appendChild(item);
      }
      body.appendChild(list);
    }
    if (outcome !== "idle") {
      title.setAttribute("tabindex", "-1");
      try {
        title.focus();
      } catch (focusError) {
        /* Focusing the heading is optional. */
      }
    }
  }

  function schedulePaint(win, view) {
    function paint() {
      try {
        render(win.document, view);
      } catch (renderError) {
        /* Do not surface the exception; it could contain a URL. */
      }
    }
    var ready = "loading";
    try {
      ready = win.document.readyState;
    } catch (readyError) {
      ready = "complete";
    }
    if (ready === "loading" && typeof win.document.addEventListener === "function") {
      win.document.addEventListener("DOMContentLoaded", paint, { once: true });
    } else {
      paint();
    }
  }

  function boot(win) {
    var search = "";
    var hash = "";
    var readError = false;
    try {
      search = win.location.search || "";
      hash = win.location.hash || "";
    } catch (readLocationError) {
      readError = true;
      search = "";
      hash = "";
    }
    var scrubbed = false;
    try {
      win.history.replaceState(null, "", win.location.pathname || "/");
      scrubbed = true;
    } catch (scrubError) {
      scrubbed = false;
    }
    var hadQuery = !(search === "" || search === "?");
    var hadHash = !(hash === "" || hash === "#");
    var hadResponse = hadQuery || hadHash;

    var expected = null;
    var storageError = false;
    try {
      expected = win.sessionStorage.getItem(EXPECTED_STATE_KEY);
    } catch (storageReadError) {
      expected = null;
      storageError = true;
    }

    var view;
    if (readError) {
      view = failureModel(true);
    } else {
      view = handleAuthorizationCallback({
        search: search,
        hash: hash,
        expectedState: expected,
        storageError: storageError
      });
    }
    if (!scrubbed && hadResponse) view = scrubFailedModel();

    search = "";
    hash = "";
    expected = null;

    if (view.consumeExpected === true && storageError !== true) {
      try {
        win.sessionStorage.removeItem(EXPECTED_STATE_KEY);
      } catch (storageRemoveError) {
        /* The value was not written anywhere else. */
      }
    }
    schedulePaint(win, view);
  }

  if (typeof document !== "undefined") {
    boot(window);
  }

  if (typeof globalThis !== "undefined" && globalThis.__OAUTH_CALLBACK_TEST__ === true) {
    globalThis.__oauthCallback = {
      handleAuthorizationCallback: handleAuthorizationCallback,
      boot: boot,
      EXPECTED_STATE_KEY: EXPECTED_STATE_KEY
    };
  }
}());
