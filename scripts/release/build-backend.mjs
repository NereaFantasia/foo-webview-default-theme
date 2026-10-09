import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { build } from 'vite';
import { isStableVersion } from '../../src/update/contract.ts';

/** 后端只用 Node 内置模块，构建工具与主题共用，不在用户机器上安装 npm 包。
 * @param {string} version
 * @param {string} outDir
 */
export async function buildBackend(version, outDir) {
  if (!isStableVersion(version)) throw new Error('后端版本必须为稳定版');
  for (const [entry, name] of [
    ['main.ts', 'server.cjs'],
    ['updater.ts', 'updater.cjs'],
  ])
    await build({
      configFile: false,
      publicDir: false,
      define: { __BACKEND_VERSION__: JSON.stringify(version) },
      build: {
        outDir,
        emptyOutDir: false,
        target: 'node24',
        minify: false,
        lib: {
          entry: fileURLToPath(new URL(`../../backend/${entry}`, import.meta.url)),
          formats: ['cjs'],
          fileName: () => name,
        },
        rolldownOptions: {
          external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
        },
      },
    });
}
