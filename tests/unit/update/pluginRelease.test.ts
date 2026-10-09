import { describe, expect, it } from 'vitest';
import { rootSigner, signRoot } from '../../fixtures/rootSigning.ts';
import {
  pluginFits,
  selectPluginCandidate,
  verifyPluginRelease,
} from '../../../src/update/pluginRelease.ts';
import type { PluginCandidate } from '../../../src/update/contract.ts';

const FILE_HASH = 'a'.repeat(64);
const RELEASE = {
  format: 1,
  component: 'foo_ui_webview2',
  version: '2.1.0',
  arch: 'x64',
  updater: 1,
  profileCompatible: true,
  hosts: ['2.25.8.0'],
  previous: ['2.0.0'],
  themes: ['0.2.0'],
  files: ['foo_ui_webview2.dll', 'WebView2Loader.dll'].map((path) => ({
    path,
    size: 1024,
    sha256: FILE_HASH,
  })),
};
const INSTALLED = { arch: 'x64', plugin: '2.0.0', theme: '0.2.0' } as const;

describe('插件发行契约', () => {
  it('前后端共用签名与明确兼容组合', async () => {
    const key = await rootSigner('plugin');
    const text = await signRoot(JSON.stringify(RELEASE), [key]);
    const release = await verifyPluginRelease(text, [key]);
    expect(release).toEqual(RELEASE);
    expect(pluginFits(release, INSTALLED)).toBe(true);
    expect(pluginFits(release, { ...INSTALLED, arch: 'x86' })).toBe(false);
    expect(pluginFits(release, { ...INSTALLED, plugin: '2.0.1' })).toBe(false);
    expect(pluginFits(release, { ...INSTALLED, theme: '0.3.0' })).toBe(false);
    await expect(verifyPluginRelease(text, [await rootSigner('other')])).rejects.toThrow('签名');
  });

  it.each([
    { version: '2.0.0' },
    { previous: ['2.2.0'] },
    { profileCompatible: false },
    { arch: 'arm64' },
    { hosts: ['2.25.8'] },
    { updater: 2 },
    { files: [...RELEASE.files, { path: 'foobar2000.exe', size: 1024, sha256: FILE_HASH }] },
    { files: [RELEASE.files[0], RELEASE.files[0]] },
    { files: RELEASE.files.map((file) => ({ ...file, size: 65 * 1024 * 1024 })) },
  ])('拒绝不受支持的发行内容 %j', async (changes) => {
    const key = await rootSigner('plugin');
    const text = await signRoot(JSON.stringify({ ...RELEASE, ...changes }), [key]);
    await expect(verifyPluginRelease(text, [key])).rejects.toThrow();
  });

  it('摘要只选更高的同架构版本，并按发行哈希排除失败项', () => {
    const candidate = (
      version: string,
      arch: 'x64' | 'x86',
      sha256 = FILE_HASH,
    ): PluginCandidate => ({
      version,
      arch,
      sha256,
      size: 1024,
      url: 'https://example.com/plugin.json',
    });
    const candidates = [
      candidate('2.0.0', 'x64'),
      candidate('2.4.0', 'x86'),
      candidate('2.2.0', 'x64', 'b'.repeat(64)),
      candidate('2.1.0', 'x64'),
    ];
    expect(selectPluginCandidate(candidates, INSTALLED)?.version).toBe('2.2.0');
    expect(selectPluginCandidate(candidates, INSTALLED, ['b'.repeat(64)])?.version).toBe('2.1.0');
    expect(selectPluginCandidate([candidates[0]!], INSTALLED)).toBeNull();
  });
});
