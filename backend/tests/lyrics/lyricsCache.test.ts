import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startLyricsCache } from '../../lyrics/lyricsCache.ts';
import { LYRICS_CACHE_ENTRY_LIMIT } from '../../../src/server/lyricsCacheProtocol.ts';

const DIRECTORIES: string[] = [];
const CLOSE: (() => void)[] = [];

afterEach(async () => {
  for (const close of CLOSE.splice(0)) close();
  for (const directory of DIRECTORIES.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function start() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'theme-lyrics-cache-')));
  DIRECTORIES.push(directory);
  const cache = startLyricsCache(directory);
  CLOSE.push(() => cache.dispose());
  return cache;
}

const KEY = 'a'.repeat(64);

describe('歌词缓存请求', () => {
  it('写入后读得到，没写过的答没有，「没有结果」读回 null', async () => {
    const cache = await start();
    expect(cache.request('get', { key: KEY })).toEqual({ found: false });
    expect(cache.request('put', { key: KEY, data: '{"a":1}' })).toEqual({ success: true });
    expect(cache.request('get', { key: KEY })).toEqual({ found: true, data: '{"a":1}' });
    cache.request('put', { key: 'b'.repeat(64), data: null });
    expect(cache.request('get', { key: 'b'.repeat(64) })).toEqual({ found: true, data: null });
  });

  it('键不合格、内容不是串也不是 null、内容过长都拒收', async () => {
    const cache = await start();
    expect(() => cache.request('get', { key: 'short' })).toThrow();
    expect(() => cache.request('put', { key: KEY, data: 5 })).toThrow();
    expect(() => cache.request('put', { key: KEY })).toThrow();
    expect(() =>
      cache.request('put', { key: KEY, data: 'x'.repeat(LYRICS_CACHE_ENTRY_LIMIT + 1) }),
    ).toThrow();
    expect(cache.request('stats', {})).toEqual({ count: 0, bytes: 0 });
  });

  it('统计与清空；上限夹在合理范围里', async () => {
    const cache = await start();
    cache.request('put', { key: KEY, data: 'xy' });
    expect(cache.request('stats', {})).toEqual({ count: 1, bytes: 66 });
    expect(() => cache.request('limit', { bytes: 'many' })).toThrow();
    expect(cache.request('limit', { bytes: 1 })).toEqual({ success: true });
    expect(cache.request('stats', {})).toEqual({ count: 1, bytes: 66 });
    expect(cache.request('clear', {})).toEqual({ success: true });
    expect(cache.request('stats', {})).toEqual({ count: 0, bytes: 0 });
  });
});
