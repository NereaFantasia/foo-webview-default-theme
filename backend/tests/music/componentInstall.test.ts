import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPONENT_MARKER,
  componentDirectory,
  readNcmPackage,
  startComponentInstall,
  type ComponentInstall,
  type ComponentPackage,
} from '../../music/componentInstall.ts';
import { zipForRelease } from '../../../scripts/release/zip.mjs';

const DIRECTORIES: string[] = [];
afterEach(async () => {
  for (const directory of DIRECTORIES.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const text = (value: string) => new TextEncoder().encode(value);

async function fixture() {
  const zip = await zipForRelease([
    { path: 'package.json', bytes: text('{"private":true}\n') },
    { path: 'node_modules/demo/index.js', bytes: text('module.exports = 1;\n') },
  ]);
  const component: ComponentPackage = {
    version: '4.41.1',
    url: 'https://cnb.example.test/ncm-4.41.1/ncm-4.41.1.zip',
    size: zip.length,
    sha256: sha256(zip),
    unpackedSize: 37,
    licenses: ['MIT'],
  };
  const root = await mkdtemp(join(tmpdir(), 'theme-ncm-install-'));
  DIRECTORIES.push(root);
  const components = join(root, 'components');
  return {
    zip,
    component,
    components,
    target: componentDirectory(components, 'ncm', component.version),
  };
}

/** 等到装好或失败。 */
async function settled(install: ComponentInstall) {
  await vi.waitFor(() => {
    const state = install.state();
    if (state.phase !== 'installed' && state.failure === null) throw new Error('还在装');
  });
  return install.state();
}

const leftovers = (components: string) =>
  existsSync(components) ? readdirSync(components).filter((name) => name.startsWith('.')) : [];

describe('网易云组件的安装', () => {
  it('下载、核对后解到带版本的目录，最后写安装标记；装好后通知一次，不重复下载', async () => {
    const { zip, component, components, target } = await fixture();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(zip));
    const onInstalled = vi.fn();
    const install = startComponentInstall({ components, package: component, fetch, onInstalled });
    expect(install.state()).toMatchObject({ phase: 'missing', received: 0, failure: null });
    install.install();
    expect(install.state().phase).toBe('downloading');
    install.install();
    expect(await settled(install)).toEqual({
      package: { version: '4.41.1', size: zip.length, unpackedSize: 37, licenses: ['MIT'] },
      phase: 'installed',
      received: zip.length,
      failure: null,
    });
    expect(readFileSync(join(target, 'node_modules', 'demo', 'index.js'), 'utf8')).toContain('1');
    expect(JSON.parse(readFileSync(join(target, COMPONENT_MARKER), 'utf8'))).toEqual({
      format: 1,
      version: '4.41.1',
      sha256: component.sha256,
    });
    expect(leftovers(components)).toEqual([]);
    install.install();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(component.url);
    expect(onInstalled).toHaveBeenCalledTimes(1);
  });

  it('已经装好的直接算已安装，不下载', async () => {
    const { component, components, target } = await fixture();
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, COMPONENT_MARKER), '{}');
    const fetch = vi.fn(async () => new Response(''));
    const install = startComponentInstall({ components, package: component, fetch });
    expect(install.state().phase).toBe('installed');
    install.install();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['download', () => Promise.resolve(new Response('', { status: 404 }))],
    ['download', () => Promise.reject(new TypeError('fetch failed'))],
    ['verify', (zip: Uint8Array) => Promise.resolve(new Response(zip.slice(0, -1)))],
    ['verify', (zip: Uint8Array) => Promise.resolve(new Response(Buffer.concat([zip, text('x')])))],
    [
      'verify',
      (zip: Uint8Array) => {
        const changed = zip.slice();
        changed[40] = changed[40]! ^ 0xff;
        return Promise.resolve(new Response(changed));
      },
    ],
  ] as const)('失败时答 %s，不留下组件目录与临时目录，可以重试 %#', async (reason, answer) => {
    const { zip, component, components, target } = await fixture();
    const fetch = vi.fn((): Promise<Response> => answer(zip));
    const install = startComponentInstall({ components, package: component, fetch });
    install.install();
    expect(await settled(install)).toMatchObject({ phase: 'missing', failure: reason });
    expect(existsSync(target)).toBe(false);
    expect(leftovers(components)).toEqual([]);
    fetch.mockImplementation(async () => new Response(zip));
    install.install();
    expect(install.state().failure).toBeNull();
    expect(await settled(install)).toMatchObject({ phase: 'installed', failure: null });
  });

  it('哈希对得上但包解不开时答 verify', async () => {
    const { component, components } = await fixture();
    const junk = text('不是 zip');
    const install = startComponentInstall({
      components,
      package: { ...component, size: junk.length, sha256: sha256(junk) },
      fetch: async () => new Response(junk),
    });
    install.install();
    expect(await settled(install)).toMatchObject({ phase: 'missing', failure: 'verify' });
  });

  it('另一个后端进程先装好了同一版本时按已安装处理，去掉自己的临时目录', async () => {
    const { zip, component, components, target } = await fixture();
    const install = startComponentInstall({
      components,
      package: component,
      fetch: async () => {
        mkdirSync(join(target, 'node_modules'), { recursive: true });
        writeFileSync(join(target, COMPONENT_MARKER), '{}');
        return new Response(zip);
      },
    });
    install.install();
    expect(await settled(install)).toMatchObject({ phase: 'installed', failure: null });
    expect(leftovers(components)).toEqual([]);
  });

  it('没有登记组件时不安装', async () => {
    const { components } = await fixture();
    const fetch = vi.fn(async () => new Response(''));
    const install = startComponentInstall({ components, package: null, fetch });
    install.install();
    expect(install.state()).toEqual({
      package: null,
      phase: 'missing',
      received: 0,
      failure: null,
    });
    expect(install.directory).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('组件描述', () => {
  const VALID = {
    format: 1,
    name: 'ncm',
    version: '4.41.1',
    url: 'https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/ncm-4.41.1/ncm-4.41.1.zip',
    size: 17465672,
    sha256: 'f'.repeat(64),
    unpackedSize: 36985384,
    licenses: ['LGPL-3.0-only', 'MIT'],
  };

  it('读出描述，多余字段不带出来', () => {
    expect(readNcmPackage(JSON.stringify({ ...VALID, extra: 1 }))).toEqual({
      version: VALID.version,
      url: VALID.url,
      size: VALID.size,
      sha256: VALID.sha256,
      unpackedSize: VALID.unpackedSize,
      licenses: VALID.licenses,
    });
  });

  it.each([
    { url: 'http://cnb.cool/ncm.zip' },
    { url: 'https://' },
    { sha256: 'F'.repeat(64) },
    { size: 0 },
    { size: 1.5 },
    { unpackedSize: -1 },
    { licenses: ['MIT', 3] },
    { licenses: [' MIT'] },
    { version: '4.41' },
    { name: 'node' },
    { format: 2 },
  ])('拒绝不合法的描述 %#', (patch) => {
    expect(readNcmPackage(JSON.stringify({ ...VALID, ...patch }))).toBeNull();
  });

  it('不是 JSON 时答 null', () => {
    expect(readNcmPackage('{')).toBeNull();
  });
});
