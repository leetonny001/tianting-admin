import { defineConfig, devices } from '@playwright/test';
import { BASE } from './playwright.config';

// FE-698 C6 跨端（e2e/xp-c6.spec.ts）：im-server 是 tianting-android 的 scripts/test-server.sh 起的（三端也连它），console-server
// 由跨端的协调脚本起好（托管本仓库 npm run build 的 dist，监听 BASE，生产 CSP），e2e/.state.json 也由它写，所以这里没有 webServer。
//   TT_XP=<运行号> TT_XP_COORD=http://127.0.0.1:<信号端口> npx playwright test -c playwright.xp.config.ts
// 结果是 Chrome，本地。
export default defineConfig({
  testDir: 'e2e',
  testMatch: /xp-c6\.spec\.ts/,
  timeout: 1_200_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: BASE, channel: 'chrome', trace: 'retain-on-failure', viewport: { width: 1280, height: 800 } },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, channel: 'chrome' },
    },
  ],
});
