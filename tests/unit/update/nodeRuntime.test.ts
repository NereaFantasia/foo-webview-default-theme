import { describe, expect, it, vi } from 'vitest';
import { runtimeArtifacts } from '../../../scripts/release/runtime-artifacts.mjs';
import { sha256 } from '../../../src/update/contract.ts';
import {
  installNodeRuntime,
  readPlatformHints,
  runtimeRunsOn,
} from '../../../src/update/nodeRuntime.ts';
import { templateFiles, toBase64 } from '../../../src/update/templateFiles.ts';
import { installTemplateHost, TEMPLATE_DIRECTORY } from '../../fixtures/templateHost.ts';

async function setup() {
  const env = installTemplateHost();
  const node = new Uint8Array(4 * 1024 * 1024 + 23).fill(31);
  const source = {
    url: 'https://example.com/node.exe',
    size: node.length,
    sha256: await sha256(node),
  };
  const published = runtimeArtifacts({
    version: '24.16.0',
    arch: 'x64',
    node,
    license: new TextEncoder().encode('许可'),
    source,
  });
  const routes = new Map(
    published.assets.map((asset) => [
      `https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/${published.tag}/${asset.name}`,
      asset.bytes,
    ]),
  );
  env.host.answer('http.get', (params) => {
    const bytes = routes.get(String(params['url']));
    return {
      success: true,
      status: bytes ? 200 : 404,
      headers: {},
      responseType: 'base64',
      body: bytes ? toBase64(bytes) : '',
    };
  });
  const files = templateFiles(env.file, TEMPLATE_DIRECTORY);
  let generation = 0;
  let alive = true;
  const selfTest = vi.fn(async () => {});
  const options = {
    suffix: () => ['abc123', 'def456', 'ghi789'][generation++] ?? 'zzz999',
    pause: async () => {},
    current: () => {
      if (!alive) throw new Error('已取消');
    },
    readLocal: async (path: string) => {
      const bytes = env.files.get(path);
      if (!bytes) throw new Error('文件不存在');
      return new Uint8Array(env.corrupt.has(path) ? [...bytes, 0] : bytes);
    },
    selfTest,
  };
  const run = () => installNodeRuntime(files, env.host.fb, published.manifest, options);
  return {
    ...env,
    options,
    selfTest,
    run,
    node,
    routes,
    manifest: published.manifest,
    cancel: () => {
      alive = false;
    },
  };
}

describe('Node 运行时安装', () => {
  it('分块追加后校验完整文件，自检通过才写标记，再次安装复用且不下载', async () => {
    const env = await setup();
    env.selfTest.mockImplementation(async () => {
      expect(env.files.has('rt/node-24.16.0-x64_abc123/installed.json')).toBe(false);
    });
    const result = await env.run();
    expect(await sha256(new Uint8Array(env.files.get(result.executable) ?? []))).toBe(
      env.manifest.sha256,
    );
    expect(env.text(`${result.directory}/installed.json`)).toContain(env.manifest.sha256);
    env.selfTest.mockImplementation(async () => {});
    const count = env.host.callsTo('http.get').length;
    expect(await env.run()).toEqual(result);
    expect(env.host.callsTo('http.get')).toHaveLength(count);
  });

  it('中途写入失败不发布标记，重试复用已校验块并写入新目录', async () => {
    const env = await setup();
    env.failWrites.add('rt/node-24.16.0-x64_abc123/.parts/part001');
    await expect(env.run()).rejects.toThrow();
    expect(env.files.has('rt/node-24.16.0-x64_abc123/installed.json')).toBe(false);
    const requests = env.host.callsTo('http.get').length;
    env.failWrites.clear();
    const result = await env.run();
    expect(result.directory).toBe('rt/node-24.16.0-x64_def456');
    expect(await sha256(new Uint8Array(env.files.get(result.executable) ?? []))).toBe(
      env.manifest.sha256,
    );
    const next = env.host.callsTo('http.get').slice(requests);
    expect(next.some((call) => call['url'] === env.manifest.parts[0]?.url)).toBe(false);
  });

  it('下载内容或组装结果损坏时不启动自检，也不发布标记', async () => {
    const env = await setup();
    env.corrupt.add('rt/node-24.16.0-x64_abc123/node.exe.partial');
    await expect(env.run()).rejects.toThrow('完整性校验失败');
    expect(env.selfTest).not.toHaveBeenCalled();
    expect(env.files.has('rt/node-24.16.0-x64_abc123/installed.json')).toBe(false);
  });

  it('自检失败保留可复用块，但不把运行时标记为可用', async () => {
    const env = await setup();
    env.selfTest.mockRejectedValue(new Error('环境不兼容'));
    await expect(env.run()).rejects.toThrow('环境不兼容');
    expect(env.files.has('rt/node-24.16.0-x64_abc123/installed.json')).toBe(false);
    const downloads = env.host.callsTo('http.get').length;
    env.routes.clear();
    env.selfTest.mockResolvedValue(undefined);
    expect((await env.run()).directory).toBe('rt/node-24.16.0-x64_abc123');
    expect(env.text('rt/node-24.16.0-x64_abc123/installed.json')).toContain(env.manifest.sha256);
    expect(env.host.callsTo('http.get')).toHaveLength(downloads);
  });
});

describe('按系统判断运行时能否运行', () => {
  const hints = (architecture: string, bitness: string, platformVersion = '15.0.0') => ({
    architecture,
    bitness,
    platformVersion,
  });

  it('只在能确定跑不了时拒绝', () => {
    expect(runtimeRunsOn('x64', hints('x86', '64'))).toBe(true);
    expect(runtimeRunsOn('x64', hints('x86', '32'))).toBe(false);
    expect(runtimeRunsOn('arm64', hints('x86', '64'))).toBe(false);
    expect(runtimeRunsOn('x64', hints('arm', '64', '15.0.0'))).toBe(true);
    expect(runtimeRunsOn('x64', hints('arm', '64', '10.0.0'))).toBe(false);
    expect(runtimeRunsOn('arm64', hints('arm', '64', '10.0.0'))).toBe(true);
    expect(runtimeRunsOn('x64', hints('arm', '64', ''))).toBe(true);
    expect(runtimeRunsOn('x64', hints('', ''))).toBe(true);
    expect(runtimeRunsOn('x64', null)).toBe(true);
  });

  it('读 UA Client Hints；接口缺失或失败时返回 null', async () => {
    const getHighEntropyValues = vi.fn(async () => hints('arm', '64', '13.0.0'));
    vi.stubGlobal('navigator', { userAgentData: { getHighEntropyValues } });
    try {
      expect(await readPlatformHints()).toEqual(hints('arm', '64', '13.0.0'));
      expect(getHighEntropyValues).toHaveBeenCalledWith([
        'architecture',
        'bitness',
        'platformVersion',
      ]);
      getHighEntropyValues.mockRejectedValueOnce(new Error('拒绝'));
      expect(await readPlatformHints()).toBeNull();
      vi.stubGlobal('navigator', {});
      expect(await readPlatformHints()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
