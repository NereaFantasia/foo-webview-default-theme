import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import metadata from './package.json' with { type: 'json' };
import { versionRef } from './src/boot/loader.ts';
import { changelogJson, parseChangelogSource } from './src/update/changelogSource.ts';

const VERSION = metadata.version;
if (!versionRef({ v: VERSION, dir: VERSION })) throw new Error('版本号必须为稳定版 SemVer');
const FRONTEND_DIR = `dist/fe/${VERSION}`;

const DEV_BACKEND_DIR = resolve('backend');
/** 后端直接引用的共享源码；改这些也要重启，不然源码直跑的还是旧协议。 */
const DEV_BACKEND_SOURCES = [
  resolve('src/server/backendProtocol.ts'),
  resolve('src/server/musicProtocol.ts'),
  resolve('src/server/ncmComponent.ts'),
  resolve('src/server/pluginProtocol.ts'),
  resolve('src/update/contract.ts'),
  resolve('src/update/loaderContract.ts'),
  resolve('src/update/pluginRelease.ts'),
  resolve('src/update/rootTrust.ts'),
  resolve('src/update/zipArchive.ts'),
];

/** 后端源码的构建哈希；页面拿它判断已起的进程是不是当前源码。 */
function devBackendHash(): string {
  const digest = createHash('sha256');
  function visit(directory: string, prefix = ''): void {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      // 后端测试不参与运行，改它们不必重启。
      if (!prefix && entry.name === 'tests') continue;
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path, name);
      else if (entry.isFile()) {
        digest.update(name);
        digest.update(readFileSync(path));
      }
    }
  }
  visit(DEV_BACKEND_DIR);
  for (const source of DEV_BACKEND_SOURCES) {
    digest.update(source);
    digest.update(readFileSync(source));
  }
  return digest.digest('hex').slice(0, 16);
}

/**
 * 开发服务器把仓库根与后端源码哈希写进页面，后端源码一变就通知页面重启。
 * 页面侧自己经宿主拉起后端，这里不碰进程，生产构建也不带这两条提示。
 */
function devBackendWatch(): Plugin {
  let hash = devBackendHash();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    name: 'theme-dev-backend',
    apply: 'serve',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { name: 'dev-backend-source', content: resolve('.') },
        injectTo: 'head',
      },
      {
        tag: 'meta',
        attrs: { name: 'dev-backend-build', content: hash },
        injectTo: 'head',
      },
    ],
    configureServer(server) {
      // 关掉 HMR 的运行方式不需要这些通知，也不该再往监听表里加文件。
      if (server.config.server.hmr === false) return;
      const inside = (file: string) => {
        const path = resolve(file);
        if (path === `${DEV_BACKEND_DIR}\\tests` || path.startsWith(`${DEV_BACKEND_DIR}\\tests\\`))
          return false;
        return (
          DEV_BACKEND_SOURCES.includes(path) ||
          path === DEV_BACKEND_DIR ||
          path.startsWith(`${DEV_BACKEND_DIR}\\`)
        );
      };
      server.watcher.add([DEV_BACKEND_DIR, ...DEV_BACKEND_SOURCES]);
      server.watcher.on('all', (_event, file) => {
        if (!inside(file)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const next = devBackendHash();
          if (next === hash) return;
          hash = next;
          server.ws.send({ type: 'custom', event: 'dev-backend:changed', data: { hash: next } });
        }, 200);
      });
      server.httpServer?.once('close', () => {
        if (timer) clearTimeout(timer);
      });
    },
  };
}

// AMLL 的未用背景层会保留 Pixi；Material 的顶层配色方案实例也会保留未用算法。
// 这几类模块没有需要单独执行的初始化，主线程与 Worker 都只保留实际使用的导出；CSS 仍有副作用。
const TREE_SHAKE = {
  moduleSideEffects: (id: string) =>
    id.endsWith('.css') ||
    !/[\\/](@pixi|@applemusic-like-lyrics[\\/]core|@material[\\/]material-color-utilities)[\\/]/.test(
      id,
    ),
};

/** 安装标记最后生成；发行清单的哈希由打包发行物时提供，普通构建不伪造发行身份。 */
function writeInstallation(): void {
  const root = resolve(FRONTEND_DIR);
  copyFileSync(resolve('dist/index.html'), join(root, 'loader.html'));
  // 更新日志也在安装哈希里，必须先写出；只收到本版为止的条目。
  const changelog = parseChangelogSource(readFileSync(resolve('CHANGELOG.md'), 'utf8'));
  writeFileSync(join(root, 'changelog.json'), changelogJson(changelog, VERSION));
  const files: Record<string, string> = {};
  function visit(relative = ''): void {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile())
        files[path] = createHash('sha256')
          .update(readFileSync(join(root, path)))
          .digest('hex');
    }
  }
  visit();
  const releaseSha256 = process.env.THEME_RELEASE_SHA256;
  if (releaseSha256 !== undefined && !/^[0-9a-f]{64}$/.test(releaseSha256))
    throw new Error('发行清单哈希无效');
  writeFileSync(
    join(root, 'installed.json'),
    JSON.stringify({
      schema: 1,
      version: VERSION,
      files,
      ...(releaseSha256 ? { releaseSha256 } : {}),
    }) + '\n',
  );
  writeFileSync(
    resolve('dist/current.json'),
    JSON.stringify({ schema: 1, frontend: { version: { v: VERSION, dir: VERSION } } }) + '\n',
  );
}

export default defineConfig({
  // 宿主从本地目录加载页面，资源路径必须是相对的。
  base: './',
  plugins: [
    react(),
    devBackendWatch(),
    { name: 'theme-installation', apply: 'build', writeBundle: writeInstallation },
  ],
  // Fluent 的 react-tabster 与它依赖的 tabster 各带一份 keyborg（2.x 与 3.x）。两份共用 window 上的
  // 同一张实例表，却各自从 k1 起编号，编号撞了就会互相注销，键盘导航的焦点判断随之失灵。只打包一份。
  resolve: { dedupe: ['keyborg'] },
  // 端口固定：宿主的开发服务器地址按它填，strictPort 让端口被占时直接失败，不静默换端口。
  server: { port: 5190, strictPort: true },
  worker: { rolldownOptions: { treeshake: TREE_SHAKE } },
  build: {
    outDir: FRONTEND_DIR,
    // 桌面歌词弹窗是第二个页面，与主页面同一个版本目录，主窗口按自己的地址找到它。
    rolldownOptions: {
      input: { main: resolve('index.html'), desktopLyrics: resolve('desktop-lyrics.html') },
      treeshake: TREE_SHAKE,
    },
  },
});
