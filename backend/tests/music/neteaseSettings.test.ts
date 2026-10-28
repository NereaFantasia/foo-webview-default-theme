import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startNeteaseSettings } from '../../music/neteaseSettings.ts';

const ROOTS: string[] = [];
const DEFAULTS = { cookie: null, nickname: null, unblock: false };

afterEach(async () => {
  for (const root of ROOTS.splice(0)) await rm(root, { recursive: true, force: true });
});

async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'theme-netease-'));
  ROOTS.push(root);
  return root;
}

describe('网易云设置', () => {
  it('没有文件、文件损坏或格式不对时按未登录、解灰关闭处理', async () => {
    const root = await directory();
    expect((await startNeteaseSettings(root)).get()).toEqual(DEFAULTS);
    for (const text of [
      '{broken',
      JSON.stringify({ schema: 2, cookie: null, nickname: null, unblock: true }),
      JSON.stringify({ schema: 1, cookie: '', nickname: null, unblock: true }),
      JSON.stringify({ schema: 1, cookie: null, nickname: null, unblock: 'true' }),
    ]) {
      await writeFile(join(root, 'music-netease.v1.json'), text);
      expect((await startNeteaseSettings(root)).get()).toEqual(DEFAULTS);
    }
  });

  it('修改写进文件后才生效，重启后读回；同时到达的修改依次写，不互相覆盖', async () => {
    const root = await directory();
    const settings = await startNeteaseSettings(root);
    await Promise.all([
      settings.update({ cookie: 'MUSIC_U=a', nickname: '听众' }),
      settings.update({ unblock: true }),
    ]);
    const signedIn = { cookie: 'MUSIC_U=a', nickname: '听众', unblock: true };
    expect(settings.get()).toEqual(signedIn);
    expect((await startNeteaseSettings(root)).get()).toEqual(signedIn);
    await settings.update({ cookie: null, nickname: null });
    expect(JSON.parse(await readFile(join(root, 'music-netease.v1.json'), 'utf8'))).toEqual({
      schema: 1,
      cookie: null,
      nickname: null,
      unblock: true,
    });
  });

  it('写不进去时报设置不可用，已生效的设置不变', async () => {
    const root = await directory();
    await mkdir(join(root, 'music-netease.v1.json'));
    const settings = await startNeteaseSettings(root);
    await expect(settings.update({ unblock: true })).rejects.toMatchObject({
      code: 'settings-unavailable',
    });
    expect(settings.get()).toEqual(DEFAULTS);
  });
});
