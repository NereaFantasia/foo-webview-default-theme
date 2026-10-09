import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import metadata from './package.json' with { type: 'json' };
import { versionRef } from './src/boot/loader.ts';
import { changelogJson, parseChangelogSource } from './src/update/changelogSource.ts';

const VERSION = metadata.version;
if (!versionRef({ v: VERSION, dir: VERSION })) throw new Error('版本号必须为稳定版 SemVer');
const FRONTEND_DIR = `dist/fe/${VERSION}`;

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
    rolldownOptions: { treeshake: TREE_SHAKE },
  },
});
