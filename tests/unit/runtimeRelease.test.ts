import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runtimeArtifacts } from '../../scripts/release/runtime-artifacts.mjs';
import { verifyRuntimeArtifacts } from '../../scripts/release/runtime-verify.mjs';
import { backendArtifacts } from '../../scripts/release/backend-artifacts.mjs';
import { sha256 } from '../../scripts/release/artifacts.mjs';
import { readZip } from '../../src/update/zipArchive.ts';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const path = await realpath(directory);
    if (
      !path.startsWith((await realpath(tmpdir())) + sep) ||
      !basename(path).startsWith('theme-runtime-')
    )
      throw new Error('清理路径无效');
    await rm(path, { recursive: true, force: true });
  }
});

async function prepare() {
  const node = new Uint8Array(4 * 1024 * 1024 + 3).fill(42);
  const result = runtimeArtifacts({
    version: '24.16.0',
    arch: 'x64',
    node,
    license: new TextEncoder().encode('许可'),
    source: {
      url: 'https://nodejs.org/dist/v24.16.0/win-x64/node.exe',
      size: node.length,
      sha256: sha256(node),
    },
  });
  const directory = await mkdtemp(join(tmpdir(), 'theme-runtime-'));
  directories.push(directory);
  for (const asset of result.assets) await writeFile(join(directory, asset.name), asset.bytes);
  return { directory, result };
}

describe('运行时发行物', () => {
  it('独立标签的全部附件可重建原文件，任何分块损坏都会拒绝发布', async () => {
    const { directory, result } = await prepare();
    expect(verifyRuntimeArtifacts(directory)).toMatchObject({
      tag: result.tag,
      manifest: result.manifest,
    });
    await writeFile(join(directory, 'node.part001'), '损坏');
    expect(() => verifyRuntimeArtifacts(directory)).toThrow('附件校验失败');
  });
  it('构建的后端包含入口与许可，补装描述精确引用运行时清单', async () => {
    const { directory, result } = await prepare();
    const built = await backendArtifacts(
      '0.1.5',
      join(directory, 'runtime.json'),
      join(directory, 'be'),
    );
    expect(built.manifest.runtime.url).toContain(`/${result.tag}/runtime.json`);
    const zip = await readZip(new Uint8Array(built.bytes));
    expect(zip.ok).toBe(true);
    if (!zip.ok) return;
    expect(zip.files.map((file) => file.path).sort()).toEqual([
      'LICENSE',
      'server.cjs',
      'updater.cjs',
    ]);
    expect(
      new TextDecoder().decode(zip.files.find((file) => file.path === 'server.cjs')?.bytes),
    ).toContain('0.1.5');
  });
});
