import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  nextPluginRootPayload,
  pluginArtifacts,
  verifyPluginArtifacts,
} from '../../scripts/release/plugin-artifacts.mjs';
import { publicSpki, signEnvelope } from '../../scripts/release/signing.mjs';
import { readRootPayload } from '../../src/update/contract.ts';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const path = await realpath(directory);
    if (
      !path.startsWith((await realpath(tmpdir())) + sep) ||
      !basename(path).startsWith('theme-plugin-release-')
    )
      throw new Error('临时目录超出清理范围');
    await rm(path, { recursive: true, force: true });
  }
});

function pe(arch: 'x64' | 'x86', version = [2, 1, 0, 0]): Uint8Array {
  const bytes = Buffer.alloc(256);
  bytes.write('MZ');
  bytes.writeUInt32LE(64, 0x3c);
  bytes.writeUInt32LE(0x4550, 64);
  bytes.writeUInt16LE(arch === 'x64' ? 0x8664 : 0x14c, 68);
  bytes.writeUInt16LE(0x2000, 86);
  Buffer.from('VS_VERSION_INFO\0', 'utf16le').copy(bytes, 96);
  bytes.writeUInt32LE(0xfeef04bd, 128);
  bytes.writeUInt32LE((version[0]! << 16) | version[1]!, 136);
  bytes.writeUInt32LE((version[2]! << 16) | version[3]!, 140);
  return new Uint8Array(bytes);
}

async function setup(arch: 'x64' | 'x86' = 'x64') {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const signer = { keyId: 'plugin', privateKeyPem };
  const keys = [{ keyId: signer.keyId, spki: publicSpki(privateKeyPem) }];
  const metadata = {
    version: '2.1.0',
    arch,
    profileCompatible: true,
    hosts: ['2.25.8.0'],
    previous: ['2.0.0'],
    themes: ['0.2.0'],
  };
  const files = ['foo_ui_webview2.dll', 'WebView2Loader.dll'].map((name) => ({
    name,
    bytes: pe(arch),
  }));
  const artifacts = await pluginArtifacts(metadata, files, [signer], keys);
  return { signer, keys, metadata, files, artifacts };
}

const PREVIOUS = JSON.stringify({
  format: 1,
  serial: 8,
  minUpdater: 1,
  channels: { stable: [] },
  changelog: { url: 'https://example.com/changelog.json', size: 8, sha256: 'a'.repeat(64) },
  custom: { preserved: true },
});

describe('插件发行材料', () => {
  it('生成独立标签、签名和两份 DLL，根清单保留主题字段', async () => {
    const env = await setup();
    expect(env.artifacts.tag).toBe('plugin-2.1.0-win-x64');
    expect(env.artifacts.assets.map((item) => item.name)).toEqual([
      'foo_ui_webview2.dll',
      'WebView2Loader.dll',
      'plugin.json',
    ]);
    const payload = nextPluginRootPayload(PREVIOUS, env.artifacts.candidate);
    expect(JSON.parse(payload)).toMatchObject({
      serial: 9,
      channels: { stable: [] },
      custom: { preserved: true },
      changelog: JSON.parse(PREVIOUS).changelog,
    });
    const reading = readRootPayload(payload);
    expect(reading.kind === 'ok' && reading.payload.plugins).toEqual([env.artifacts.candidate]);
  });

  it('同一版本不同架构并列，更新一个架构不覆盖另一个', async () => {
    const x64 = await setup();
    const x86 = await setup('x86');
    const first = nextPluginRootPayload(PREVIOUS, x64.artifacts.candidate);
    const second = nextPluginRootPayload(first, x86.artifacts.candidate);
    const replaced = nextPluginRootPayload(second, {
      ...x64.artifacts.candidate,
      sha256: 'c'.repeat(64),
    });
    expect(JSON.parse(replaced).plugins).toHaveLength(2);
    expect(JSON.parse(replaced).plugins[1]).toEqual(x86.artifacts.candidate);
  });

  it('合并根清单时保留未知架构、未来候选与附加字段', async () => {
    const env = await setup();
    const future = { ...env.artifacts.candidate, arch: 'arm64', requiresUpdater: 2 };
    const older = { ...env.artifacts.candidate, version: '2.0.1', custom: { preserved: true } };
    const previous = JSON.stringify({
      ...JSON.parse(PREVIOUS),
      plugins: [future, older],
    });
    expect(JSON.parse(nextPluginRootPayload(previous, env.artifacts.candidate)).plugins).toEqual([
      env.artifacts.candidate,
      future,
      older,
    ]);
  });

  it('上传前重新验签并核对磁盘附件，篡改后拒绝', async () => {
    const env = await setup();
    const directory = await mkdtemp(join(tmpdir(), 'theme-plugin-release-'));
    directories.push(directory);
    for (const asset of env.artifacts.assets)
      await writeFile(join(directory, asset.name), asset.bytes);
    const manifest = await signEnvelope(nextPluginRootPayload(PREVIOUS, env.artifacts.candidate), [
      env.signer,
    ]);
    await writeFile(join(directory, 'manifest.json'), manifest);
    expect(await verifyPluginArtifacts(directory, env.keys)).toMatchObject({
      tag: 'plugin-2.1.0-win-x64',
      serial: 9,
    });
    await writeFile(join(directory, 'foo_ui_webview2.dll'), pe('x86'));
    await expect(verifyPluginArtifacts(directory, env.keys)).rejects.toThrow('附件校验失败');
  });

  it('架构、真实 DLL 版本和 profile 兼容承诺都必须满足', async () => {
    const env = await setup();
    await expect(
      pluginArtifacts({ ...env.metadata, arch: 'x86' }, env.files, [env.signer], env.keys),
    ).rejects.toThrow('PE 架构');
    await expect(
      pluginArtifacts({ ...env.metadata, version: '2.2.0' }, env.files, [env.signer], env.keys),
    ).rejects.toThrow('文件版本');
    await expect(
      pluginArtifacts(
        { ...env.metadata, profileCompatible: false },
        env.files,
        [env.signer],
        env.keys,
      ),
    ).rejects.toThrow('不兼容');
    await expect(
      pluginArtifacts(
        env.metadata,
        [...env.files, { name: 'foobar2000.exe', bytes: pe('x64') }],
        [env.signer],
        env.keys,
      ),
    ).rejects.toThrow('两份 DLL');
  });
});
