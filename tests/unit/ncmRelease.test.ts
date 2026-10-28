import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DOWNLOAD_BASE } from '../../scripts/release/manifests.mjs';
import { ncmArtifacts, verifyComponentArtifacts } from '../../scripts/release/ncm-artifacts.mjs';
import { readZip } from '../../src/update/zipArchive.ts';

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

const NCM = '@neteasecloudmusicapienhanced/api';

/** 仓库的样子：NCM 依赖 a，a 依赖嵌套安装的 b@2；顶层另有不相干的 b@1。 */
function repository(pinned = '1.2.3') {
  const root = mkdtempSync(join(tmpdir(), 'theme-ncm-release-'));
  temporary.push(root);
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('package.json', { dependencies: { [NCM]: pinned, other: '1.0.0' } });
  const api = `node_modules/${NCM}`;
  write(`${api}/package.json`, {
    name: NCM,
    version: '1.2.3',
    license: 'MIT',
    dependencies: { a: '^1.0.0' },
  });
  for (const file of ['main.js', 'README.md', 'index.d.ts', 'test/case.js', 'LICENSE'])
    write(`${api}/${file}`, file);
  // 不导出 package.json 的包要沿 node_modules 去找。
  write('node_modules/a/package.json', {
    name: 'a',
    version: '1.0.0',
    license: 'ISC',
    exports: { '.': './index.js' },
    dependencies: { b: '^2.0.0' },
  });
  for (const file of ['index.js', 'docs/guide.txt', 'NOTICE'])
    write(`node_modules/a/${file}`, file);
  write('node_modules/a/node_modules/b/package.json', {
    name: 'b',
    version: '2.0.0',
    licenses: [{ type: 'MIT', url: 'https://example.test/LICENSE' }],
  });
  for (const file of ['index.js', 'index.js.map'])
    write(`node_modules/a/node_modules/b/${file}`, file);
  write('node_modules/b/package.json', { name: 'b', version: '1.0.0', license: 'GPL-3.0' });
  write('node_modules/b/index.js', 'index.js');
  return root;
}

describe('网易云组件附件', () => {
  it('按依赖闭包取包、保持嵌套布局，去掉文档、声明、源码映射与测试，留下许可', async () => {
    const built = await ncmArtifacts(repository());
    const zip = await readZip(new Uint8Array(built.bytes));
    expect(zip.ok).toBe(true);
    if (!zip.ok) return;
    expect(zip.files.map((file) => file.path)).toEqual([
      `node_modules/${NCM}/LICENSE`,
      `node_modules/${NCM}/main.js`,
      `node_modules/${NCM}/package.json`,
      'node_modules/a/NOTICE',
      'node_modules/a/index.js',
      'node_modules/a/node_modules/b/index.js',
      'node_modules/a/node_modules/b/package.json',
      'node_modules/a/package.json',
      'package.json',
    ]);
    expect(built).toMatchObject({ tag: 'ncm-1.2.3', name: 'ncm-1.2.3.zip', packages: 3 });
    expect(built.component).toMatchObject({
      version: '1.2.3',
      url: `${DOWNLOAD_BASE}/ncm-1.2.3/ncm-1.2.3.zip`,
      size: built.bytes.length,
      licenses: ['ISC', 'MIT'],
    });
    expect(built.component.unpackedSize).toBe(
      zip.files.reduce((total, file) => total + file.bytes.length, 0),
    );
    expect((await ncmArtifacts(repository())).component.sha256).toBe(built.component.sha256);
  });

  it('版本没写死，或装的版本与 package.json 不符时停下', async () => {
    await expect(ncmArtifacts(repository('^1.2.3'))).rejects.toThrow('必须写死');
    await expect(ncmArtifacts(repository('1.2.4'))).rejects.toThrow('不符');
  });

  it('核对写出的附件：描述与 zip 对得上才通过', async () => {
    const built = await ncmArtifacts(repository());
    const out = mkdtempSync(join(tmpdir(), 'theme-ncm-release-'));
    temporary.push(out);
    writeFileSync(join(out, built.name), built.bytes);
    writeFileSync(join(out, 'ncm.json'), built.text);
    expect(verifyComponentArtifacts(out, 'ncm')).toMatchObject({
      tag: 'ncm-1.2.3',
      assets: [{ name: 'ncm-1.2.3.zip', sha256: built.component.sha256 }],
    });
    writeFileSync(join(out, built.name), built.bytes.slice(1));
    expect(() => verifyComponentArtifacts(out, 'ncm')).toThrow('组件附件与描述不符');
  });
});
