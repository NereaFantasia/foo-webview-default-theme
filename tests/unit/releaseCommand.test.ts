import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOT_URL } from '../../src/update/contract.ts';
import { runtimeArtifacts } from '../../scripts/release/runtime-artifacts.mjs';

const mocks = vi.hoisted(() => ({
  args: [] as string[],
  git: vi.fn(),
  write: vi.fn(),
  copy: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawnSync: mocks.git }));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  existsSync: () => false,
  writeFileSync: mocks.write,
  copyFileSync: mocks.copy,
}));
vi.mock('node:util', async (original) => {
  const module = await original<typeof import('node:util')>();
  return {
    ...module,
    parseArgs: (options: Parameters<typeof module.parseArgs>[0]) =>
      module.parseArgs({ ...options, args: mocks.args }),
  };
});
vi.mock('../../scripts/release/artifacts.mjs', () => ({
  verifyArtifacts: mocks.verify,
  sha256: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
}));

const REPO = 'foo-ui-webview2/default-theme';
const REMOTE = `https://cnb.cool/${REPO}.git`;
const REMOTE_MAIN = '389824ea7a0d622f3d1158e5c4db65ec9d173a57\trefs/heads/main';
const CNB_README = readFileSync(
  new URL('../../scripts/release/cnb-readme.md', import.meta.url),
  'utf8',
);
const PROBE_TAG = 'probe-20261004';
const MANIFEST = 'signed-manifest';
const ASSETS = ['release.json', 'fe-0.1.0.zip', 'foo-webview-default-theme-0.1.0.zip'].map(
  (name) => {
    const bytes = new TextEncoder().encode(name);
    return { name, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  },
);

interface NetworkCall {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function network(
  options: {
    rootStatus?: number;
    downloadStatus?: number;
    existingStable?: boolean;
    runtime?: Map<string, Uint8Array>;
  } = {},
) {
  const calls: NetworkCall[] = [];
  const events: string[] = [];
  mocks.write.mockImplementation((path: string) => {
    events.push(`write:${path}`);
  });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.includes('/releases/download/rt-node-')) {
      const bytes = options.runtime?.get(url);
      events.push(`runtime-download:${url.split('/').pop()}`);
      return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
    }
    if (url === ROOT_URL)
      return events.some((event) => event.endsWith('manifest.json'))
        ? new Response(MANIFEST)
        : new Response(null, { status: options.rootStatus ?? 404 });
    if (url.includes('/-/releases/tags/'))
      return options.existingStable
        ? Response.json({ id: 'r1', tag_name: PROBE_TAG, prerelease: false, assets: [] })
        : new Response(null, { status: 404 });
    if (url.endsWith('/-/releases') && method === 'POST')
      return Response.json({ id: 'r1' }, { status: 201 });
    if (url.endsWith('/asset-upload-url'))
      return Response.json(
        {
          upload_url: 'https://upload.example/asset',
          verify_url: '/-/releases/r1/asset-upload-confirmation/token/file',
        },
        { status: 201 },
      );
    if (url.startsWith('https://upload.example/') || url.includes('/asset-upload-confirmation/'))
      return new Response(null, { status: 200 });
    const asset = ASSETS.find((item) => url.endsWith(`/${item.name}`));
    if (asset && url.includes('/-/releases/download/')) {
      events.push(`download:${asset.name}`);
      return new Response(asset.bytes, { status: options.downloadStatus ?? 200 });
    }
    throw new Error(`没有预期这次请求：${method} ${url}`);
  });
  return { calls, events };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('CNB_TOKEN', 'local-test-token');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.args = ['--dir', 'artifacts', '--checkout', 'cnb-checkout'];
  mocks.verify.mockResolvedValue({
    version: '0.1.0',
    tag: 'v0.1.0',
    serial: 1,
    manifest: MANIFEST,
    notes: {},
    assets: ASSETS,
  });
  mocks.git.mockImplementation((_command: string, args: string[]) => ({
    status: 0,
    stderr: '',
    stdout: args[0] === 'remote' ? REMOTE : '',
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function command() {
  await import('../../scripts/release/publish-cnb.mjs');
}
function gitArgs(): string[][] {
  return mocks.git.mock.calls.map((call) => call[1]);
}

describe('CNB 发布命令', () => {
  it.each(['runtime.json', 'node.part000', 'LICENSE', null])(
    '公共运行时附件 %s 缺失时不推进根清单，完整时才能发布',
    async (missing) => {
      const node = new Uint8Array([1, 2, 3]);
      const built = runtimeArtifacts({
        version: '24.16.0',
        arch: 'x64',
        node,
        license: new Uint8Array([4]),
        source: {
          url: 'https://nodejs.org/dist/v24.16.0/win-x64/node.exe',
          size: node.length,
          sha256: createHash('sha256').update(node).digest('hex'),
        },
      });
      const base = `https://cnb.cool/${REPO}/-/releases/download/${built.tag}`;
      const manifest = built.assets.find((asset) => asset.name === 'runtime.json');
      if (!manifest) throw new Error('缺少运行时清单');
      const runtime = new Map(
        built.assets
          .filter((asset) => asset.name !== missing)
          .map((asset) => [`${base}/${asset.name}`, asset.bytes]),
      );
      mocks.verify.mockResolvedValueOnce({
        version: '0.1.0',
        tag: 'v0.1.0',
        serial: 1,
        manifest: MANIFEST,
        notes: {},
        assets: ASSETS,
        runtime: {
          url: `${base}/runtime.json`,
          size: manifest.bytes.length,
          sha256: createHash('sha256').update(manifest.bytes).digest('hex'),
        },
      });
      const { events } = network({ runtime });
      if (missing) {
        await expect(command()).rejects.toThrow('公开运行时');
        expect(mocks.write).not.toHaveBeenCalled();
        expect(mocks.git).not.toHaveBeenCalled();
      } else {
        await expect(command()).resolves.toBeUndefined();
        const written = events.findIndex((event) => event.endsWith('manifest.json'));
        expect(written).toBeGreaterThan(-1);
        expect(
          events.slice(0, written).filter((event) => event.startsWith('runtime-download:')),
        ).toEqual([
          'runtime-download:runtime.json',
          'runtime-download:node.part000',
          'runtime-download:LICENSE',
        ]);
      }
    },
  );
  it('探测只创建独立预发布与附件，空仓库只推说明和许可，不读取或写入根清单', async () => {
    mocks.args.push('--probe', PROBE_TAG);
    const { calls, events } = network();
    await expect(command()).resolves.toBeUndefined();
    expect(
      calls.find((call) => call.url.endsWith('/-/releases') && call.method === 'POST')?.body,
    ).toMatchObject({ tag_name: PROBE_TAG, prerelease: true, make_latest: 'false' });
    expect(calls.some((call) => call.url === ROOT_URL)).toBe(false);
    expect(
      calls.filter((call) => call.url.includes('/-/releases/download/')).map((call) => call.url),
    ).toEqual(
      ASSETS.map(
        (item) => `https://cnb.cool/${REPO}/-/releases/download/${PROBE_TAG}/${item.name}`,
      ),
    );
    expect(events.filter((event) => event.startsWith('write:'))).toHaveLength(1);
    expect(events.some((event) => event.endsWith('manifest.json'))).toBe(false);
    expect(gitArgs().filter((args) => args[0] === 'push')).toEqual([['push', 'origin', 'main']]);
    expect(gitArgs().filter((args) => args[0] === 'add')).toEqual([
      ['add', 'README.md', 'LICENSE'],
    ]);
  });

  it('仓库已有提交时照样写 README 与许可，内容没变就不提交、不推送', async () => {
    mocks.args.push('--probe', PROBE_TAG);
    mocks.git.mockImplementation((_command: string, args: string[]) => ({
      status: 0,
      stderr: '',
      stdout: args[0] === 'remote' ? REMOTE : args[0] === 'ls-remote' ? REMOTE_MAIN : '',
    }));
    network();
    await expect(command()).resolves.toBeUndefined();
    expect(mocks.write).toHaveBeenCalledWith(expect.stringMatching(/README\.md$/), CNB_README);
    expect(mocks.copy).toHaveBeenCalledTimes(1);
    expect(gitArgs().filter((args) => args.includes('commit'))).toEqual([]);
    expect(gitArgs().filter((args) => args[0] === 'push')).toEqual([]);
  });

  it('仓库已有提交而 README 或许可有变化时，先提交推送再建发行版', async () => {
    mocks.args.push('--probe', PROBE_TAG);
    const { calls } = network();
    let statusReads = 0;
    let releaseBeforePush: boolean | null = null;
    mocks.git.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'push')
        releaseBeforePush = calls.some(
          (call) => call.url.endsWith('/-/releases') && call.method === 'POST',
        );
      // 第一次读状态是克隆是否干净，第二次是写入说明之后。
      const changed = args[0] === 'status' && ++statusReads > 1;
      return {
        status: 0,
        stderr: '',
        stdout:
          args[0] === 'remote'
            ? REMOTE
            : args[0] === 'ls-remote'
              ? REMOTE_MAIN
              : changed
                ? 'M  README.md'
                : '',
      };
    });
    await expect(command()).resolves.toBeUndefined();
    expect(gitArgs().filter((args) => args.includes('commit'))).toHaveLength(1);
    expect(gitArgs().filter((args) => args[0] === 'push')).toEqual([['push', 'origin', 'main']]);
    expect(releaseBeforePush).toBe(false);
  });

  it.each([false, true])('干跑不写文件、不上传、不推送（探测=%s）', async (probe) => {
    mocks.args.push('--dry-run');
    if (probe) mocks.args.push('--probe', PROBE_TAG);
    const { calls } = network();
    await expect(command()).resolves.toBeUndefined();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(gitArgs()).toEqual([['ls-remote', '--heads', REMOTE, 'main']]);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it.each(['v0.1.0', '', 'probe-../main'])(
    '非法探测标签 %s 在联网和 Git 操作前拒绝',
    async (tag) => {
      mocks.args.push('--probe', tag);
      const { calls } = network();
      await expect(command()).rejects.toThrow('探测标签');
      expect(calls).toEqual([]);
      expect(mocks.git).not.toHaveBeenCalled();
      expect(mocks.verify).not.toHaveBeenCalled();
    },
  );

  it('已有正式发行版占用探测标签时不上传或写入', async () => {
    mocks.args.push('--probe', PROBE_TAG);
    const { calls } = network({ existingStable: true });
    await expect(command()).rejects.toThrow('普通发行版占用');
    expect(mocks.write).not.toHaveBeenCalled();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('线上根清单读取失败时停止，不能按首次发布上传', async () => {
    const { calls } = network({ rootStatus: 503 });
    await expect(command()).rejects.toThrow('HTTP 503');
    expect(calls.map((call) => call.url)).toEqual([ROOT_URL]);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.git).not.toHaveBeenCalled();
  });

  it('正式发布在所有附件匿名核对成功之后才写根清单', async () => {
    const { calls, events } = network();
    await expect(command()).resolves.toBeUndefined();
    const written = events.findIndex((event) => event.endsWith('manifest.json'));
    expect(written).toBeGreaterThan(-1);
    expect(events.slice(0, written).filter((event) => event.startsWith('download:'))).toEqual(
      ASSETS.map((item) => `download:${item.name}`),
    );
    expect(
      calls.find((call) => call.url.endsWith('/-/releases') && call.method === 'POST')?.body,
    ).toMatchObject({ tag_name: 'v0.1.0', prerelease: false, make_latest: 'true' });
    expect(gitArgs().filter((args) => args[0] === 'push')).toHaveLength(2);
  });

  it('匿名下载失败时保留已传附件，根清单不写也不推', async () => {
    const { calls, events } = network({ downloadStatus: 503 });
    await expect(command()).rejects.toThrow('HTTP 503');
    expect(events.some((event) => event.endsWith('manifest.json'))).toBe(false);
    expect(gitArgs().filter((args) => args[0] === 'push')).toHaveLength(1);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });
});
