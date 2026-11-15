import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MISSING_TTL_MS, openLyricsStore, type LyricsStore } from '../../lyrics/lyricsStore.ts';

const OPEN: LyricsStore[] = [];
const DIRECTORIES: string[] = [];

afterEach(async () => {
  for (const store of OPEN.splice(0)) store.close();
  for (const directory of DIRECTORIES.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function file() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'theme-lyrics-')));
  DIRECTORIES.push(directory);
  return join(directory, 'lyrics.sqlite');
}

function open(path: string, limitBytes?: number) {
  const store = openLyricsStore(path, limitBytes);
  OPEN.push(store);
  return store;
}

const key = (name: string) => name.padEnd(64, '0');

describe('歌词缓存库', () => {
  it('关掉再打开仍在；没记过的答 undefined；「没有结果」读回 null', async () => {
    const path = await file();
    const first = openLyricsStore(path);
    first.put(key('a'), '{"lines":1}');
    first.put(key('b'), null);
    first.close();
    const second = open(path);
    expect(second.get(key('a'))).toEqual({ data: '{"lines":1}' });
    expect(second.get(key('b'))).toEqual({ data: null });
    expect(second.get(key('c'))).toBeUndefined();
  });

  it('「没有结果」过了有效期就当没记过并删掉；有内容的不过期', async () => {
    const store = open(await file());
    store.put(key('missing'), null, 1000);
    store.put(key('found'), 'x', 1000);
    expect(store.get(key('missing'), 1000 + MISSING_TTL_MS)).toEqual({ data: null });
    expect(store.get(key('missing'), 1001 + MISSING_TTL_MS * 2)).toBeUndefined();
    expect(store.stats().count).toBe(1);
    expect(store.get(key('found'), 1000 + MISSING_TTL_MS * 100)).toEqual({ data: 'x' });
  });

  it('同一个键再写覆盖旧值', async () => {
    const store = open(await file());
    store.put(key('a'), 'old');
    store.put(key('a'), 'new');
    expect(store.get(key('a'))).toEqual({ data: 'new' });
    expect(store.stats().count).toBe(1);
  });

  it('超过上限时按最近使用淘汰；读过的比没读过的留得久', async () => {
    const entry = 'z'.repeat(200);
    const store = open(await file(), 2 * (64 + 200) + 10);
    store.put(key('a'), entry, 1);
    store.put(key('b'), entry, 2);
    store.get(key('a'), 3);
    store.put(key('c'), entry, 4);
    expect(store.get(key('a'), 5)).toEqual({ data: entry });
    expect(store.get(key('c'), 5)).toEqual({ data: entry });
    expect(store.get(key('b'), 5)).toBeUndefined();
  });

  it('统计条数与字节；清空后归零；调低上限立即淘汰', async () => {
    const store = open(await file());
    store.put(key('a'), 'x'.repeat(100), 1);
    store.put(key('b'), 'y'.repeat(100), 2);
    expect(store.stats()).toEqual({ count: 2, bytes: 2 * (64 + 100) });
    store.setLimit(64 + 100 + 5);
    expect(store.stats().count).toBe(1);
    expect(store.get(key('b'), 3)).toEqual({ data: 'y'.repeat(100) });
    store.clear();
    expect(store.stats()).toEqual({ count: 0, bytes: 0 });
  });

  it('字节数按 UTF-8 算，不按字符数', async () => {
    const store = open(await file());
    store.put(key('a'), '春'.repeat(10), 1);
    expect(store.stats().bytes).toBe(64 + 30);
  });
});
