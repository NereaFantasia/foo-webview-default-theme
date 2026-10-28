import { describe, expect, it, vi } from 'vitest';
import { DEV_SESSION_ID } from '../../../src/server/devBackendLaunch.ts';
import { startDevBackend, type DevBackendPage } from '../../../src/server/devBackend.ts';
import { installTemplateHost, TEMPLATE_DIRECTORY } from '../../fixtures/templateHost.ts';

const TOKEN = 'a'.repeat(64);
const SESSION_ID = DEV_SESSION_ID;
const URL_BASE = 'http://localhost:5190/';
const RUNTIME = 'rt/node-24.21.0-x64_a92576/node.exe';
const BE = 'be/0.2.0_da690f/server.cjs';
const NCM = 'be/0.2.0_da690f/ncm.json';
const LX = 'be/0.2.0_da690f/lxserver.json';
const SOURCE = 'E:\\repo\\backend\\main.ts';
const BUILT = 'E:\\repo\\release\\dev-backend\\server.cjs';

function storage(entries: Record<string, string> = {}) {
  return {
    getItem: (key: string) => entries[key] ?? null,
    setItem: (key: string, value: string) => {
      entries[key] = value;
    },
    entries,
  };
}

function descriptor(port: number, launchId = 'a0000000-0000-4000-8000-000000000001') {
  return JSON.stringify({
    protocol: 1,
    version: '0.2.0',
    installId: '1e000000-0000-4000-8000-000000000001',
    sessionId: SESSION_ID,
    launchId,
    pid: 4321,
    port,
    token: TOKEN,
  });
}

function page(source: string | null, build: string | null = 'abcdef1234567890'): DevBackendPage {
  return { source, build };
}

function setup(initial: Readonly<Record<string, string>> = {}) {
  const env = installTemplateHost({
    [RUNTIME]: 'bin',
    [BE]: 'bin',
    [NCM]: '{"version":"4.41.1"}',
    [LX]: '{"version":"2.1.3"}',
    ...initial,
  });
  const connectManual = vi.fn(async () => true);
  const spawn = vi.fn();
  const log = vi.fn();
  env.host.answer('shell.spawn', (params) => {
    spawn(params);
    const args = Array.isArray(params['args']) ? params['args'].map(String) : [];
    const at = args.indexOf('--launch-id');
    const launchId = at >= 0 ? args[at + 1] : '';
    if (launchId) env.write(`state/backend-run-${launchId}.json`, descriptor(60333));
    return { success: true, processId: 4321 };
  });
  env.host.answer('file.write', (params) => {
    const path = String(params['path']);
    const stop = /backend-stop-(.+)\.json$/.exec(path);
    if (stop?.[1]) env.files.delete(`state/backend-run-${stop[1]}.json`);
    return { success: true, bytesWritten: 2 };
  });
  return { ...env, connectManual, spawn, log };
}

function url(query = '') {
  return new URL(`${URL_BASE}${query}`);
}

describe('开发服务器的后端短路', () => {
  it('地址里登记的手动后端优先，不碰模板目录', async () => {
    const env = setup();
    const list = vi.spyOn(env.host.fb.file, 'list');
    const service = startDevBackend(
      { connectManual: env.connectManual },
      {
        host: {
          file: env.host.fb.file,
          shell: env.host.fb.shell,
          getSource: async () => {
            throw new Error('不该问来源');
          },
        },
        storage: storage(),
        url: url(`?manual-backend=5191:${TOKEN}`),
        page: page(null),
        log: env.log,
      },
    );
    await expect(service.ready).resolves.toBe(true);
    expect(env.connectManual).toHaveBeenCalledWith({ port: 5191, token: TOKEN });
    expect(list).not.toHaveBeenCalled();
  });

  it('同一份源码的已起进程直接接上，不重复拉起', async () => {
    const env = setup({ [`state/backend-${SESSION_ID}.json`]: descriptor(60101) });
    const readHealth = vi.fn(async () => ({ entry: SOURCE }));
    const service = startDevBackend(
      { connectManual: env.connectManual },
      {
        host: {
          file: env.host.fb.file,
          shell: env.host.fb.shell,
          getSource: async () => {
            throw new Error('不该问来源');
          },
        },
        storage: storage({
          'default-theme.dev-backend.dir.v1': TEMPLATE_DIRECTORY,
          'default-theme.dev-backend.build.v1': 'abcdef1234567890',
        }),
        url: url(),
        page: page(SOURCE),
        readHealth,
        log: env.log,
      },
    );
    await expect(service.ready).resolves.toBe(true);
    expect(env.connectManual).toHaveBeenCalledWith({ port: 60101, token: TOKEN });
    expect(env.spawn).not.toHaveBeenCalled();
    expect(readHealth).toHaveBeenCalledWith({
      port: 60101,
      token: TOKEN,
      launchId: expect.any(String),
    });
  });

  it('源码直跑：带上类型转换、版本与组件描述', async () => {
    const env = setup();
    const service = startDevBackend(
      { connectManual: env.connectManual },
      {
        host: {
          file: env.host.fb.file,
          shell: env.host.fb.shell,
          getSource: async () => ({
            success: true,
            source: 'devServer' as const,
            activeTemplateName: 'default',
            templatesDirectory: TEMPLATE_DIRECTORY.slice(0, -'default'.length - 1),
          }),
        },
        storage: storage({ 'default-theme.dev-backend.src.v1': BUILT }),
        url: new URL(
          `${URL_BASE}?backend-src=${encodeURIComponent('E:\\repo\\release\\dev-backend')}`,
        ),
        page: page(SOURCE),
        log: env.log,
      },
    );
    await expect(service.ready).resolves.toBe(true);
    const params = env.spawn.mock.calls[0]?.[0] as { args?: string[]; cwd?: string };
    const args = params.args ?? [];
    expect(args[0]).toBe('--experimental-transform-types');
    expect(args[1]).toBe('--import');
    expect(args[2]).toContain('__BACKEND_VERSION__');
    expect(args[3]).toBe(SOURCE);
    expect(args[args.indexOf('--allow-origin') + 1]).toBe('http://localhost:5190');
    expect(args[args.indexOf('--ncm') + 1]).toBe(
      `${TEMPLATE_DIRECTORY}\\be\\0.2.0_da690f\\ncm.json`,
    );
    expect(args[args.indexOf('--lx') + 1]).toBe(
      `${TEMPLATE_DIRECTORY}\\be\\0.2.0_da690f\\lxserver.json`,
    );
    expect(params.cwd).toBe(TEMPLATE_DIRECTORY);
    expect(env.connectManual).toHaveBeenCalledWith({
      port: 60333,
      token: TOKEN,
    });
  });

  it('源码直跑时仓库里有现成的组件就直接用，不再传组件描述', async () => {
    // 假的文件系统只认模板目录下的路径，仓库就放在那下面。
    const repo = `${TEMPLATE_DIRECTORY}\\repo`;
    const env = setup({
      'repo/node_modules/@neteasecloudmusicapienhanced/api/package.json': '{}',
      'repo/release/lxserver/index.js': '',
    });
    const service = startDevBackend(
      { connectManual: env.connectManual },
      {
        host: {
          file: env.host.fb.file,
          shell: env.host.fb.shell,
          getSource: async () => ({
            success: true,
            source: 'devServer' as const,
            activeTemplateName: 'default',
            templatesDirectory: TEMPLATE_DIRECTORY.slice(0, -'default'.length - 1),
          }),
        },
        storage: storage(),
        url: url(),
        page: page(`${repo}\\backend\\main.ts`),
        log: env.log,
      },
    );
    await expect(service.ready).resolves.toBe(true);
    const args = (env.spawn.mock.calls[0]?.[0] as { args?: string[] }).args ?? [];
    expect(args[args.indexOf('--ncm-dir') + 1]).toBe(repo);
    expect(args[args.indexOf('--lx-dir') + 1]).toBe(`${repo}\\release\\lxserver`);
    expect(args).not.toContain('--ncm');
    expect(args).not.toContain('--lx');
  });

  it('没有注入源码时退回 backend-src 指的构建', async () => {
    const env = setup();
    const service = startDevBackend(
      { connectManual: env.connectManual },
      {
        host: {
          file: env.host.fb.file,
          shell: env.host.fb.shell,
          getSource: async () => ({
            success: true,
            source: 'devServer' as const,
            activeTemplateName: 'default',
            templatesDirectory: TEMPLATE_DIRECTORY.slice(0, -'default'.length - 1),
          }),
        },
        storage: storage({ 'default-theme.dev-backend.src.v1': BUILT }),
        url: url(),
        page: page(null),
        log: env.log,
      },
    );
    await expect(service.ready).resolves.toBe(true);
    const params = env.spawn.mock.calls[0]?.[0] as { args?: string[] };
    expect(params.args?.[0]).toBe(BUILT);
    expect(params.args).not.toContain('--experimental-transform-types');
    expect(params.args).not.toContain('--ncm');
    expect(params.args).not.toContain('--lx');
  });

  it('没有源码也没有 backend-src 时用模板目录里已装的后端', async () => {
    const env = setup();
    const service = startDevBackend(
      { connectManual: env.connectManual },
      {
        host: {
          file: env.host.fb.file,
          shell: env.host.fb.shell,
          getSource: async () => {
            throw new Error('不该问来源');
          },
        },
        storage: storage({ 'default-theme.dev-backend.dir.v1': TEMPLATE_DIRECTORY }),
        url: url(),
        page: page(null),
        log: env.log,
      },
    );
    await expect(service.ready).resolves.toBe(true);
    const params = env.spawn.mock.calls[0]?.[0] as { args?: string[] };
    expect(params.args?.[0]).toBe(`${TEMPLATE_DIRECTORY}\\${BE.replaceAll('/', '\\')}`);
  });

  it('拉起失败时读错误文件并说明原因', async () => {
    const env = installTemplateHost({ [RUNTIME]: 'bin', [BE]: 'bin', [NCM]: '{}' });
    const log = vi.fn();
    env.host.answer('shell.spawn', (params) => {
      const args = Array.isArray(params['args']) ? params['args'].map(String) : [];
      const launchId = args[args.indexOf('--launch-id') + 1] ?? '';
      env.write(`state/backend-error-${launchId}.json`, JSON.stringify({ error: '参数无效' }));
      return { success: true, processId: 4321 };
    });
    const service = startDevBackend(
      { connectManual: vi.fn(async () => true) },
      {
        host: {
          file: env.host.fb.file,
          shell: env.host.fb.shell,
          getSource: async () => {
            throw new Error('不该问来源');
          },
        },
        storage: storage({ 'default-theme.dev-backend.dir.v1': TEMPLATE_DIRECTORY }),
        url: url(),
        page: page(SOURCE),
        log,
      },
    );
    await expect(service.ready).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('backend-error'));
  });

  it('源码哈希变化时重启，同一哈希不重复重启', async () => {
    const env = setup();
    const service = startDevBackend(
      { connectManual: env.connectManual },
      {
        host: {
          file: env.host.fb.file,
          shell: env.host.fb.shell,
          getSource: async () => {
            throw new Error('不该问来源');
          },
        },
        storage: storage({ 'default-theme.dev-backend.dir.v1': TEMPLATE_DIRECTORY }),
        url: url(),
        page: page(SOURCE, 'bbbbbbbbbbbbbbbb'),
        log: env.log,
      },
    );
    await expect(service.ready).resolves.toBe(true);
    expect(env.spawn).toHaveBeenCalledTimes(1);
    await expect(service.restart('cccccccccccccccccccc')).resolves.toBe(true);
    expect(env.spawn).toHaveBeenCalledTimes(2);
    await expect(service.restart('cccccccccccccccccccc')).resolves.toBe(true);
    expect(env.spawn).toHaveBeenCalledTimes(2);
    expect(env.connectManual).toHaveBeenCalledTimes(2);
  });
});
