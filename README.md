# tianting-admin

天听管理后台（业务运营）：用户、群、社交配置、消息元数据、审计、账号管理。**天听**是自研 IM 平台，替换腾讯 IM。

|            |                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 状态       | 第一批页面完成（FE-400～FE-416），第二批（封禁、正文、删除、禁言、系统通知）未开始                         |
| 技术       | React + Vite + TypeScript，没有组件库                                                                      |
| 后端       | 只调用 console-server 的 `/console/api/*`（同源、Cookie 会话）。**浏览器里没有任何 IM 管理密钥或签名私钥** |
| 需求和任务 | tianting-server 的 `docs/prd/PRD-admin-v1.0.md`、`docs/tasks/frontend-admin.md`                            |

## 约定

- **没有用组件库**：console-server 的 CSP 是 `style-src 'self' 'nonce-…'`，不允许内联样式。样式全部在 `src/app.css`，ESLint 禁止 `style` 属性。没有放宽 CSP。
- **纯文本**：用户可控内容一律走 `<Text>`，ESLint 禁止 `dangerouslySetInnerHTML`、`innerHTML` 等（`npm run lint` 用 `lint-fixtures/` 的违规夹具验证规则真的生效）。
- **头像**：只有首字母占位，不加载业务方的 URL。二维码在本地生成，TOTP 种子不发给第三方。
- **错误文案**：按 `code` + `reason` 查 `src/api/errors.ts`，不显示服务端的 `msg`（只从中取 userId）。
- **step-up**：写操作收到 4038 时 `src/api/client.ts` 弹动态码框，通过后自动重放原请求。页面不用管。
- **没有本地存储**：CSRF 令牌只放内存，刷新后重新取。

## 开发

```bash
npm install
```

```bash
npm run dev
```

开发服务器把 `/console` 转发到 `CONSOLE_SERVER`（默认 `http://127.0.0.1:8090`）。

```bash
npm run lint && npm test && npm run build && npm run check:dist
```

## 端到端测试

```bash
npm run e2e
```

`e2e/stack.mjs` 启动真实的 im-server 和 console-server（测试模式），console-server 托管 `dist/`，所以响应头就是生产的 CSP。需要本机 Postgres（`CON_TEST_ADMIN_URL`）、Go，以及同级目录的 `tianting-console-server` 和 `tianting-server`（或 `im-mvp`）源码。

TOTP 同一步不能用两次，所以测试冻结 [C 钟] 和 [IM 钟]，每次要动态码就一起推进 31 秒（`e2e/helpers.ts`）。

看样式：`SHOTS=目录 npx playwright test e2e/zz-screenshots.spec.ts`。

## 部署

构建产物 `dist/` 由 console-server 托管（`CON_ADMIN_WEB_DIR`），不单独部署。
