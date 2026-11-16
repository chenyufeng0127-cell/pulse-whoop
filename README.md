# pulse-whoop

个人 WHOOP 数据助手的公开静态页面。当前是准备阶段，只提供隐私说明和 OAuth 授权回调，不连接账户，也不交换令牌。

这些页面与 WHOOP 没有附属或背书关系。WHOOP 是其权利人的商标。

## 页面

| 路径 | 作用 |
| --- | --- |
| `/` | 说明这两个地址是做什么的 |
| `/privacy/` | 隐私说明 |
| `/callback/` | 授权回调 |

站点要放在 GitHub Pages 的项目路径 `/pulse-whoop/` 下，因此完整路径是 `/pulse-whoop/privacy/` 和 `/pulse-whoop/callback/`。页面里的链接使用相对路径，本地和 Pages 上都能跟着这个前缀走。

## 部署完成前不要登记

GitHub 项目站点的常规地址会是：

- `https://chenyufeng0127-cell.github.io/pulse-whoop/`
- `https://chenyufeng0127-cell.github.io/pulse-whoop/privacy/`
- `https://chenyufeng0127-cell.github.io/pulse-whoop/callback/`

写出这份说明时，Pages 还没有发布这些页面。在浏览器实际打开、并确认看到的是本仓库的中文页面之前，不要把上述地址登记到 WHOOP。登记回调时必须与地址栏逐字符相同，包括 `https`、主机名、`/pulse-whoop/callback/` 和结尾斜杠。WHOOP 要求授权请求中的重定向地址和开发者后台登记值完全一致。见 [WHOOP OAuth 文档](https://developer.whoop.com/docs/developing/oauth/)。

隐私说明地址同样等页面生效后再填写。

## 这些页面不做什么

- 不实现授权码换令牌，也没有后端。
- 不保存客户端密钥、授权码、访问令牌或刷新令牌。仓库里没有客户端 ID。
- 不收集健康数据，也不要把健康数据放进本仓库。
- 不加载第三方脚本、字体、广告或分析。
- 回调页没有登录框，也没有提交密钥的表单。

客户端密钥只应放在你自己的 Grok Bot 机密客户端里。不要把它发到普通聊天、邮件或这个公开仓库。

## 回调如何处理授权响应

WHOOP 使用授权码流程。用户在 WHOOP 同意或拒绝后，浏览器会被送到登记的回调地址。成功时查询参数里会有授权码和 `state`；拒绝或失败时会有 `error` 和 `state`。官方说明要求自行生成的 `state` 恰好为 8 个字符。

本页的脚本在 `<head>` 里同步执行，顺序是：

1. 先读下查询参数和片段。
2. 立刻调用 `history.replaceState`，只留下路径，去掉查询参数和片段。
3. 再决定页面上显示哪一种通用结果。
4. 授权码、令牌和客户端密钥不进入页面文字、`localStorage`、日志或网络请求。用过的预期 `state` 会从 `sessionStorage` 删除。

内容安全策略禁止连接、字体和第三方图片，脚本和样式只用页面内联内容的哈希。引用策略是 `no-referrer`。GitHub Pages 不提供自定义响应头，所以这些限制写在 HTML 里。`frame-ancestors` 不能通过 meta 生效。

直接打开回调页、或者这个浏览器里没有事先保存的预期值时，结果是“未能核对”。看起来像 `state` 的返回值不会被当成已经核对。预期值还必须是恰好 8 位字母或数字；即便两个更长或不含字母数字的字符串完全相同，也不算核对通过。本页不会自己生成 `state` 来凑结果。

对得上，只说明返回值与跳转前保存的值一致。账户此时仍未连接。

### 以后真正发起授权时

发起页面必须在跳转到 WHOOP 之前完成这些事。本仓库还没有这个发起页面。

1. 用 `crypto.getRandomValues` 生成 8 个字符，不要用 `Math.random`。字母表是大小写英文字母和数字。每个随机字节若大于等于 248 就丢掉，否则取 `alphabet[byte % 62]`。248 等于 62×4，用来避免取模偏差。
2. 把这个值写入同一浏览器来源的 `sessionStorage`，键名是 `pulse_whoop_oauth_expected_state`。不要写进公开仓库。
3. 授权请求的 `redirect_uri` 必须与 WHOOP 后台、以及当时实际生效的回调地址完全相同。
4. 授权地址以 WHOOP 文档为准，目前是 `https://api.prod.whoop.com/oauth/oauth2/auth`。本仓库不会把浏览器转到那里。
5. 回到本页后，只有返回的 `state` 与第 2 步保存的值完全一致，才显示“对得上”。没有保存过预期值时，一律是未能核对。

令牌交换应以后由你的机密客户端向 WHOOP 文档中的令牌地址发起，目前是 `https://api.prod.whoop.com/oauth/oauth2/token`。本仓库不调用它，也不提供可粘贴的请求模板。那一步必须是你之后明确发起的安全交接，而不是普通聊天，也不是这个静态页上的表单。本页收到响应后不会把授权码留着等你稍后提交。

### 托管日志

`history.replaceState` 只能改地址栏，不能撤回浏览器已经发出的那一次页面请求。若 URL 里带有授权码，GitHub Pages 可能在访问日志里看到它。本页不会再发第二次带该值的请求，也不能承诺 GitHub 会把日志保留多久。若你不能接受这一点，请不要把这个静态地址登记为正式回调。

## 本地检查

需要 Node.js 22。在仓库根目录：

```bash
node tools/render-pages.mjs
node --test tests/*.test.mjs
```

改 `src/callback.js` 或 `site/assets/site.css` 之后要重新运行渲染脚本。回调页和 404 页的内容安全策略哈希来自渲染结果；测试会核对哈希，以及发布出来的脚本是否与 `src/callback.js` 一致。

只在本机看页面：

```bash
node tests/serve.mjs
```

然后打开它打印的 `/pulse-whoop/`、`/privacy/` 和 `/callback/`。`/tests/manual-initiator.html` 是本地练习：没有输入框，只用占位符 `local-test-code` 走一遍 state 核对。它不在 `site/` 里，不会被 Pages 发布，也不会连接 WHOOP。

## 发布到 GitHub Pages

`.github/workflows/pages.yml` 只在 `main` 分支有推送时，或之后在 Actions 里手动运行时，把 `site/` 目录部署到 GitHub Pages。令牌权限只有：

- `contents: read`
- `pages: write`
- `id-token: write`

检出时关闭了持久凭据。工作流不会在 pull request 上运行，也不会获得写入仓库内容的权限。Actions 版本固定到提交号。

发布出来的是 `site/`，不包括测试、README 和本地练习页。`site/.nojekyll` 会一并上传。

GitHub 要求这个工作流位于默认分支，Pages 才会接受这次部署。合并到 `main` 之前，页面不会因为本工作流而更新。

### 合并之后若页面没有出现

1. 确认 GitHub Actions 已启用。
2. 打开仓库 Settings → Pages → Build and deployment，Source 选 GitHub Actions。
3. 看 Actions 里 “Deploy static content to Pages” 是否成功。
4. 用浏览器打开上面的三个地址，确认正文是本仓库的中文页面，而不是 404。
5. 再把隐私说明和回调地址原样填进 WHOOP。不要同时填入客户端密钥。
