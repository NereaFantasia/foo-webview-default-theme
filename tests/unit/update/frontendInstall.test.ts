import { describe, expect, it } from 'vitest';
import { zipEntries } from '../../../scripts/release/zip.mjs';
import { TEMPLATE_DIRECTORY, installTemplateHost } from '../../fixtures/templateHost.ts';
import { sha256 } from '../../../src/update/contract.ts';
import { installFrontend } from '../../../src/update/frontendInstall.ts';
import { json, marker } from '../../../src/update/loaderContract.ts';
import { templateFiles } from '../../../src/update/templateFiles.ts';

const RELEASE = 'e'.repeat(64);
const text = (value: string) => new TextEncoder().encode(value);
const PACKAGE = zipEntries([
  { path: 'index.html', bytes: text('<!doctype html><title>主题</title>') },
  { path: 'loader.html', bytes: text('<!doctype html>') },
  { path: 'assets/App.js', bytes: text('console.log(1)'.repeat(100)) },
]);

function setup(initial: Readonly<Record<string, string>> = {}, directory = TEMPLATE_DIRECTORY) {
  const env = installTemplateHost(initial, directory);
  const suffixes = ['abc123', 'def456', 'ghi789', 'jkl012'];
  let pauses = 0;
  const options = {
    suffix: () => suffixes.shift() ?? 'zzz999',
    pause: async () => {
      pauses += 1;
    },
  };
  const files = templateFiles(env.file, directory);
  return {
    env,
    pauses: () => pauses,
    install: (zip = PACKAGE) => installFrontend(files, '0.2.0', RELEASE, zip, options),
  };
}

describe('installFrontend', () => {
  it('写进新目录，读回核对后最后原子写安装标记', async () => {
    const { env, install, pauses } = setup();
    const result = await install();
    expect(result).toEqual({ ok: true, version: { v: '0.2.0', dir: '0.2.0_abc123' } });
    expect(env.text('fe/0.2.0_abc123/assets/App.js')).toBe('console.log(1)'.repeat(100));
    const writes = env.host.callsTo('file.write').map((params) => String(params['path']));
    expect(writes.at(-1)).toBe(`${TEMPLATE_DIRECTORY}\\fe\\0.2.0_abc123\\installed.json`);
    expect(env.atomic.get('fe/0.2.0_abc123/installed.json')).toBe(true);
    expect(pauses()).toBe(6);
    const stored = json(env.text('fe/0.2.0_abc123/installed.json') ?? null);
    expect(stored).toMatchObject({
      schema: 1,
      version: '0.2.0',
      releaseSha256: RELEASE,
      files: { 'index.html': await sha256(text('<!doctype html><title>主题</title>')) },
    });
    expect(marker(stored, { v: '0.2.0', dir: '0.2.0_abc123' })).toEqual({
      releaseSha256: RELEASE,
    });
  });

  it('目录名撞上已有目录时换一个后缀', async () => {
    const { install } = setup({ 'fe/0.2.0_abc123/index.html': 'old' });
    expect(await install()).toMatchObject({ ok: true, version: { dir: '0.2.0_def456' } });
  });

  it('包里缺入口或自带安装标记时不写任何文件', async () => {
    const { env, install } = setup();
    expect(await install(zipEntries([{ path: 'app.js', bytes: text('x') }]))).toEqual({
      ok: false,
      problem: 'entry',
    });
    const withMarker = zipEntries([
      { path: 'index.html', bytes: text('x') },
      { path: 'Installed.json', bytes: text('{}') },
    ]);
    expect(await install(withMarker)).toEqual({ ok: false, problem: 'entry' });
    expect(await install(text('不是 zip'))).toEqual({ ok: false, problem: 'format' });
    expect(env.host.callsTo('file.write')).toHaveLength(0);
  });

  it('最长的路径超限时一个文件都不写', async () => {
    // 包内路径最长 200 个字符，模板目录要足够深才会超出宿主的路径上限。
    const { env, install } = setup({}, `${TEMPLATE_DIRECTORY}\\${'p'.repeat(60)}`);
    const long = `${'a'.repeat(120)}/${'b'.repeat(79)}`;
    const zip = zipEntries([
      { path: 'index.html', bytes: text('x') },
      { path: long, bytes: text('x') },
    ]);
    expect(await install(zip)).toMatchObject({ ok: false, problem: 'path-too-long' });
    expect(env.host.callsTo('file.write')).toHaveLength(0);
  });

  it('写入失败或读回不符时不写安装标记', async () => {
    const failed = setup();
    failed.env.failWrites.add('fe/0.2.0_abc123/loader.html');
    expect(await failed.install()).toMatchObject({ ok: false, problem: 'write' });
    expect(failed.env.files.has('fe/0.2.0_abc123/installed.json')).toBe(false);

    const corrupted = setup();
    corrupted.env.corrupt.add('fe/0.2.0_abc123/assets/App.js');
    expect(await corrupted.install()).toEqual({
      ok: false,
      problem: 'verify',
      detail: 'assets/App.js',
    });
    expect(corrupted.env.files.has('fe/0.2.0_abc123/installed.json')).toBe(false);
  });

  it('发行清单哈希无效时直接拒绝', async () => {
    const env = installTemplateHost();
    const files = templateFiles(env.file, TEMPLATE_DIRECTORY);
    await expect(
      installFrontend(files, '0.2.0', 'x', PACKAGE, {
        suffix: () => 'abc123',
        pause: async () => {},
      }),
    ).rejects.toThrow('发行清单哈希');
  });
});
