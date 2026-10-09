import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, type Plugin } from 'vite';
import { expect, test } from 'vitest';
import config from '../../vite.config.ts';

async function buildWorker(optimized: boolean) {
  const retained: string[] = [];
  const inspect: Plugin = {
    name: 'inspect-color-worker',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(chunk.modules)) {
          if (module.renderedLength > 0) retained.push(id);
        }
      }
    },
  };
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    plugins: [inspect],
    build: {
      write: false,
      emptyOutDir: false,
      lib: {
        entry: resolve('src/theme/coverColorWorker.ts'),
        name: 'CoverWorker',
        formats: ['iife'],
      },
      rolldownOptions: optimized ? config.worker?.rolldownOptions : {},
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!output || !('output' in output)) throw new Error('没有生成 Worker');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk) throw new Error('没有生成 Worker 脚本');
  return { code: chunk.code, retained };
}

function runWorker(code: string, pixels: Uint8ClampedArray): unknown {
  let receive: ((event: { data: Uint8ClampedArray }) => void) | undefined;
  let result: unknown;
  runInNewContext(code, {
    Uint8ClampedArray,
    addEventListener: (_name: string, listener: typeof receive) => {
      receive = listener;
    },
    postMessage: (value: unknown) => {
      result = value;
    },
  });
  if (!receive) throw new Error('Worker 没有注册消息处理');
  receive({ data: pixels });
  return result;
}

test('定向摇树保留 CSS 与普通模块，主线程和 Worker 使用相同规则', () => {
  const treeShake = config.build?.rolldownOptions?.treeshake;
  expect(config.worker?.rolldownOptions?.treeshake).toBe(treeShake);
  if (!treeShake || typeof treeShake !== 'object') throw new Error('没有摇树配置');
  const effects = treeShake.moduleSideEffects;
  if (typeof effects !== 'function') throw new Error('没有模块副作用判定');
  for (const separator of ['/', '\\']) {
    const path = (name: string) => `/node_modules/${name}`.replaceAll('/', separator);
    expect(effects(path('@material/material-color-utilities/index.js'), false)).toBe(false);
    expect(effects(path('@applemusic-like-lyrics/core/dist/amll-core.mjs'), false)).toBe(false);
    expect(effects(path('@pixi/core/lib/index.mjs'), false)).toBe(false);
    expect(effects(path('@applemusic-like-lyrics/core/style.css'), false)).toBe(true);
    expect(effects(path('@material/material-color-utilities/theme.css'), false)).toBe(true);
    expect(effects(path('foo-webview-sdk/dist/bridge.js'), false)).toBe(true);
  }
});

test('压缩后的取色 Worker 去除未用配色方案，彩色、灰色和透明图的结果不变', async () => {
  const baseline = await buildWorker(false);
  const optimized = await buildWorker(true);
  expect(baseline.retained.some((id) => id.includes('/dynamiccolor/'))).toBe(true);
  expect(optimized.retained.some((id) => id.includes('/dynamiccolor/'))).toBe(false);
  expect(Buffer.byteLength(optimized.code)).toBeLessThan(Buffer.byteLength(baseline.code) / 2);
  const colorful = Uint8ClampedArray.from({ length: 64 * 64 * 4 }, (_, at) =>
    at % 4 === 3 ? 255 : (Math.imul(at, 31) + (at >> 4)) % 256,
  );
  const gray = Uint8ClampedArray.from({ length: 64 * 4 }, (_, at) => (at % 4 === 3 ? 255 : 128));
  for (const pixels of [colorful, gray, new Uint8ClampedArray(64 * 4)]) {
    const expected = runWorker(baseline.code, pixels);
    expect(expected).toBeDefined();
    expect(runWorker(optimized.code, pixels)).toEqual(expected);
  }
});

test('沉浸和视频页面不进入启动依赖，仍保留独立的生产入口', async () => {
  let inspected = false;
  const inspect: Plugin = {
    name: 'inspect-deferred-pages',
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).filter((entry) => entry.type === 'chunk');
      const initial = new Set<string>();
      function visit(file: string): void {
        if (initial.has(file)) return;
        initial.add(file);
        for (const dependency of bundle[file]?.type === 'chunk' ? bundle[file].imports : [])
          visit(dependency);
      }
      for (const chunk of chunks) {
        if (
          chunk.isEntry ||
          ['/src/App.tsx', '/src/app/appServices.ts'].some((path) =>
            chunk.facadeModuleId?.endsWith(path),
          )
        )
          visit(chunk.fileName);
      }
      for (const path of ['/app/ImmersivePage.tsx', '/video/VideoPage.tsx']) {
        const page = chunks.find((chunk) => chunk.facadeModuleId?.endsWith(path));
        expect(page, path).toBeDefined();
        expect(initial.has(page?.fileName ?? ''), path).toBe(false);
      }
      for (const chunk of chunks.filter((chunk) => initial.has(chunk.fileName))) {
        for (const [id, module] of Object.entries(chunk.modules)) {
          if (module.renderedLength === 0) continue;
          expect(id).not.toMatch(
            /\/immersive\/(?:analysis\/trackAnalysis|gauges\/liveLoudness|wash\/PaperCoverFlow|terrain\/terrainMount)\./,
          );
        }
      }
      const retained = chunks.flatMap((chunk) =>
        Object.entries(chunk.modules)
          .filter(([, module]) => module.renderedLength > 0)
          .map(([id]) => id),
      );
      expect(retained.some((id) => id.includes('/@pixi/'))).toBe(false);
      expect(retained.some((id) => id.includes('material-color-utilities/dynamiccolor/'))).toBe(
        false,
      );
      inspected = true;
    },
  };
  await build({
    ...config,
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    plugins: [config.plugins, inspect],
    build: { ...config.build, write: false, emptyOutDir: false },
  });
  expect(inspected).toBe(true);
}, 15_000);
