import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { keepLxApp, lxArtifacts, slimLxApp } from '../../scripts/release/lx-artifacts.mjs';
import { DOWNLOAD_BASE } from '../../scripts/release/manifests.mjs';
import { verifyComponentArtifacts } from '../../scripts/release/ncm-artifacts.mjs';
import { readZip } from '../../src/update/zipArchive.ts';

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

/**
 * 生产形态的样子：写标签的包带预编译包，ws 的两个可选原生包，嵌套安装的包，包里不是包根的 package.json，
 * 以及 npm 自己的文件。
 */
function app() {
  const root = mkdtempSync(join(tmpdir(), 'theme-lx-release-'));
  temporary.push(root);
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const pkg = (path: string, name: string, license: unknown = 'MIT') =>
    write(`node_modules/${path}/package.json`, { name, version: '1.0.0', license });
  write('package.json', { name: 'lx-music-sync-server', version: '2.1.3', license: 'Apache-2.0' });
  for (const file of ['LICENSE', 'index.js', 'package-lock.json', 'server/index.js'])
    write(file, file);
  write('node_modules/.package-lock.json', '{}');
  write('node_modules/.bin/tsc.cmd', 'shim');
  pkg('music-tag-native', 'music-tag-native');
  for (const file of ['LICENSE', 'index.js', 'browser.js', 'index.d.ts'])
    write(`node_modules/music-tag-native/${file}`, file);
  pkg('music-tag-native-win32-x64-msvc', 'music-tag-native-win32-x64-msvc');
  write('node_modules/music-tag-native-win32-x64-msvc/tagger.node', 'binary');
  pkg('bufferutil', 'bufferutil');
  write('node_modules/bufferutil/prebuilds/win32-x64/node.napi.node', 'binary');
  pkg('utf-8-validate', 'utf-8-validate');
  pkg('ws', 'ws');
  for (const file of ['index.js', 'README.md']) write(`node_modules/ws/${file}`, file);
  pkg('@scope/a', '@scope/a', 'ISC');
  write('node_modules/@scope/a/index.js', 'a');
  write('node_modules/@scope/a/node_modules/b/package.json', {
    name: 'b',
    version: '2.0.0',
    licenses: [{ type: 'BSD-3-Clause', url: 'https://example.test/LICENSE' }],
  });
  write('node_modules/@scope/a/node_modules/b/lib/package.json', { type: 'module' });
  return root;
}

describe('lxserver 组件附件', () => {
  it('换上空壳、去掉原生包，附件只留运行要用的文件与许可', async () => {
    const root = app();
    slimLxApp(root);
    const { MusicTagger } = createRequire(import.meta.url)(
      join(root, 'node_modules/music-tag-native'),
    );
    expect(() => new MusicTagger()).toThrow('music-tag-native is not bundled');

    const built = await lxArtifacts(root);
    const zip = await readZip(new Uint8Array(built.bytes));
    expect(zip.ok).toBe(true);
    if (!zip.ok) return;
    expect(zip.files.map((file) => file.path)).toEqual([
      'LICENSE',
      'index.js',
      'node_modules/@scope/a/index.js',
      'node_modules/@scope/a/node_modules/b/lib/package.json',
      'node_modules/@scope/a/node_modules/b/package.json',
      'node_modules/@scope/a/package.json',
      'node_modules/music-tag-native/LICENSE',
      'node_modules/music-tag-native/index.js',
      'node_modules/music-tag-native/package.json',
      'node_modules/ws/index.js',
      'node_modules/ws/package.json',
      'package-lock.json',
      'package.json',
      'server/index.js',
    ]);
    expect(built).toMatchObject({ tag: 'lxserver-2.1.3', name: 'lxserver-2.1.3.zip', packages: 4 });
    expect(built.descriptor).toMatchObject({
      format: 1,
      name: 'lxserver',
      version: '2.1.3',
      url: `${DOWNLOAD_BASE}/lxserver-2.1.3/lxserver-2.1.3.zip`,
      size: built.bytes.length,
      unpackedSize: zip.files.reduce((total, file) => total + file.bytes.length, 0),
      licenses: ['Apache-2.0', 'BSD-3-Clause', 'ISC', 'MIT'],
    });
    expect((await lxArtifacts(root)).descriptor.sha256).toBe(built.descriptor.sha256);
  });

  it('留一份运行目录：内容同附件；只替换空目录或像 lxserver 运行目录的', async () => {
    const root = app();
    slimLxApp(root);
    const { bytes } = await lxArtifacts(root);
    const base = mkdtempSync(join(tmpdir(), 'theme-lx-release-'));
    temporary.push(base);
    const target = join(base, 'lxserver');
    await keepLxApp(bytes, target);
    expect(readFileSync(join(target, 'server/index.js'), 'utf8')).toBe('server/index.js');
    expect(existsSync(join(target, 'node_modules/ws/README.md'))).toBe(false);
    writeFileSync(join(target, 'stale.txt'), 'old');
    await keepLxApp(bytes, target);
    expect(existsSync(join(target, 'stale.txt'))).toBe(false);

    const other = join(base, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'keep.txt'), 'x');
    await expect(keepLxApp(bytes, other)).rejects.toThrow('不像 lxserver 的运行目录');
    expect(existsSync(join(other, 'keep.txt'))).toBe(true);
  });

  it('核对写出的附件：按 lxserver.json 与 lxserver-<版本>.zip 认，名字不对的描述不收', async () => {
    const root = app();
    slimLxApp(root);
    const built = await lxArtifacts(root);
    const out = mkdtempSync(join(tmpdir(), 'theme-lx-release-'));
    temporary.push(out);
    writeFileSync(join(out, built.name), built.bytes);
    writeFileSync(join(out, 'lxserver.json'), JSON.stringify(built.descriptor));
    expect(verifyComponentArtifacts(out, 'lxserver')).toMatchObject({
      tag: 'lxserver-2.1.3',
      assets: [{ name: 'lxserver-2.1.3.zip', sha256: built.descriptor.sha256 }],
    });
    writeFileSync(join(out, 'lxserver.json'), JSON.stringify({ ...built.descriptor, name: 'ncm' }));
    expect(() => verifyComponentArtifacts(out, 'lxserver')).toThrow('组件描述无效');
  });

  it('去掉已知的原生包后还有原生文件时停下', () => {
    const root = app();
    writeFileSync(join(root, 'node_modules/ws/extra.node'), 'binary');
    expect(() => slimLxApp(root)).toThrow('包里还有原生文件：node_modules/ws/extra.node');
  });
});
