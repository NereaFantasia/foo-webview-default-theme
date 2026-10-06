import { defineConfig } from '@playwright/test';

// 缺省 5191，与开发服务器的 5190 错开；同时跑几组 e2e 时各用 THEME_PORT 指一个端口。
const port = Number(process.env.THEME_PORT) || 5191;
const localUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // Playwright 开跑时会清空输出目录；按端口分开，同时跑的几组不会清掉彼此的结果。
  outputDir: `test-results/${port}`,
  use: {
    baseURL: localUrl,
    // 文案断言按中文档写，不随运行环境的语言漂移。
    locale: 'zh-CN',
    browserName: 'chromium',
    // 宿主是 WebView2，内核与 Edge 同源。
    channel: 'msedge',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    // 不监听文件的配置：跑测试期间改动源码，正在跑的页面不会被整页重载。
    command: `npx vite --config vite.e2e.config.ts --port ${port} --strictPort --host 127.0.0.1`,
    url: localUrl,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
