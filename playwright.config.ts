import { defineConfig } from '@playwright/test';

// 缺省 5191，与开发服务器的 5190 错开；同时跑几组 e2e 时各用 THEME_PORT 指一个端口。
const port = Number(process.env.THEME_PORT) || 5191;
const localUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  // 缺省串行：用例里有依赖真实时间的悬停、动效计时，负载一高会抖。要并行就设 E2E_WORKERS（文件之间并行，
  // 文件内仍按序）；各用例有独立的页面与宿主替身，只共用一个开发服务器。
  workers: Number(process.env['E2E_WORKERS']) || 1,
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
  // 预热先于所有用例：开发服务器按首次请求编译模块，并行起跑时各 worker 的首条用例会因编译排队而超时。
  projects: [
    { name: 'warm-up', testMatch: 'warm-up.spec.ts' },
    { name: 'e2e', testIgnore: 'warm-up.spec.ts', dependencies: ['warm-up'] },
  ],
  webServer: {
    // 不监听文件的配置：跑测试期间改动源码，正在跑的页面不会被整页重载。
    command: `npx vite --config vite.e2e.config.ts --port ${port} --strictPort --host 127.0.0.1`,
    url: localUrl,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
