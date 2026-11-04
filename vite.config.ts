import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 开发时把 /console/api 转发到本机的 console-server（同源，Cookie 会话）。CSP 由 console-server 的响应头给，生产不用 meta。
export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false },
  server: { proxy: { '/console': process.env.CONSOLE_SERVER ?? 'http://127.0.0.1:8090' } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
