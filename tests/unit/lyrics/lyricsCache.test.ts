import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  LYRICS_CACHE_PREF_KEY,
  startLyricsCache,
  type LyricsCacheService,
} from '../../../src/lyrics/lyricsCache.ts';
import { lyricsQueryDigest, writeFoundLyrics } from '../../../src/lyrics/lyricsCacheCodec.ts';
import type { FoundLyrics } from '../../../src/lyrics/online/lyricsSearch.ts';
import type { LyricsQuery } from '../../../src/lyrics/online/lyricsSource.ts';
import { LYRICS_CACHE_ENTRY_LIMIT } from '../../../src/server/lyricsCacheProtocol.ts';
import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import type { ConfigValue } from '../../fixtures/hostAnswers.ts';
import { flush } from '../../fixtures/playingTrack.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const QUERY: LyricsQuery = {
  title: '曲',
  artists: ['艺'],
  album: '专',
  albumArtists: [],
  durationMs: 120_000,
};
const PREFS = { enabled: true, sources: ['lrclib'] as const };
const FOUND: FoundLyrics = {
  source: 'lrclib',
  content: { kind: 'plain', lines: ['第一行'] },
  candidate: {
    source: 'lrclib',
    ref: '1',
    title: '曲',
    artists: ['艺'],
    album: '专',
    durationMs: 0,
  },
  match: { level: 'high', points: 20 },
};

type Handler = (body: unknown) => unknown;

function setup(config: Readonly<Record<string, ConfigValue>> = {}, connected = true) {
  const host = installFakeHost({ config });
  const store = createStore();
  const port = atom<number | null>(connected ? 4321 : null);
  const handlers = new Map<string, Handler>();
  const request = vi.fn(async (path: string, body?: unknown) => {
    const handler = handlers.get(path);
    if (!handler) throw new Error(`没有 ${path}`);
    return handler(body);
  });
  const service: LyricsCacheService = startLyricsCache(
    store,
    { request, port },
    host.fb,
    createMemoryConfigWriter(host.fb),
  );
  onTestFinished(() => service.dispose());
  return {
    host,
    store,
    port,
    request,
    service,
    on: (path: string, handler: Handler) => handlers.set(path, handler),
    calls: (path: string) =>
      request.mock.calls.filter(([called]) => called === path).map(([, body]) => [path, body]),
    pref: () => store.get(service.pref),
  };
}

describe('歌词缓存偏好', () => {
  it('缺省默认记住、缓存开、上限 50 MiB；改了就保存，非法值回缺省', async () => {
    const env = setup();
    await env.service.ready;
    expect(env.pref()).toEqual({ remember: true, enabled: true, limitMb: 50 });
    expect(await env.service.setRemember(false)).toBe(true);
    expect(await env.service.setLimit(100)).toBe(true);
    expect(env.host.config.get(LYRICS_CACHE_PREF_KEY)).toEqual({
      version: 1,
      remember: false,
      enabled: true,
      limitMb: 100,
    });
    const bad = setup({
      [LYRICS_CACHE_PREF_KEY]: { version: 1, remember: 'yes', enabled: false, limitMb: 7 },
    });
    await bad.service.ready;
    expect(bad.pref()).toEqual({ remember: true, enabled: false, limitMb: 50 });
  });
});

describe('歌词缓存读写', () => {
  it('命中答歌词，「没有」答 missing，没记过、内容坏、请求失败都答 undefined', async () => {
    const env = setup();
    await env.service.ready;
    env.on('/lyrics/get', () => ({ found: true, data: writeFoundLyrics(FOUND) }));
    expect(await env.service.lookup(QUERY, PREFS)).toEqual(FOUND);
    env.on('/lyrics/get', () => ({ found: true, data: null }));
    expect(await env.service.lookup(QUERY, PREFS)).toBe('missing');
    env.on('/lyrics/get', () => ({ found: false }));
    expect(await env.service.lookup(QUERY, PREFS)).toBeUndefined();
    env.on('/lyrics/get', () => ({ found: true, data: '{"broken":true}' }));
    expect(await env.service.lookup(QUERY, PREFS)).toBeUndefined();
    env.on('/lyrics/get', () => {
      throw new Error('连接断了');
    });
    expect(await env.service.lookup(QUERY, PREFS)).toBeUndefined();
  });

  it('按查询摘要读写；「没有」写成 null；过长的不写', async () => {
    const env = setup();
    await env.service.ready;
    env.on('/lyrics/put', () => ({ success: true }));
    env.service.store(QUERY, PREFS, FOUND);
    env.service.store({ ...QUERY, title: '无词' }, PREFS, 'missing');
    await flush();
    const key = await lyricsQueryDigest(QUERY, PREFS);
    const missingKey = await lyricsQueryDigest({ ...QUERY, title: '无词' }, PREFS);
    expect(env.calls('/lyrics/put')).toEqual([
      ['/lyrics/put', { key, data: writeFoundLyrics(FOUND) }],
      ['/lyrics/put', { key: missingKey, data: null }],
    ]);
    const long: FoundLyrics = {
      ...FOUND,
      content: { kind: 'plain', lines: ['x'.repeat(LYRICS_CACHE_ENTRY_LIMIT)] },
    };
    env.service.store(QUERY, PREFS, long);
    await flush();
    expect(env.calls('/lyrics/put')).toHaveLength(2);
  });

  it('缓存关着或本地服务没连着时不发请求，写入也不发', async () => {
    const off = setup({
      [LYRICS_CACHE_PREF_KEY]: { version: 1, remember: true, enabled: false, limitMb: 50 },
    });
    await off.service.ready;
    expect(await off.service.lookup(QUERY, PREFS)).toBeUndefined();
    off.service.store(QUERY, PREFS, FOUND);
    await flush();
    expect(off.calls('/lyrics/get')).toHaveLength(0);
    expect(off.calls('/lyrics/put')).toHaveLength(0);
    const down = setup({}, false);
    await down.service.ready;
    expect(down.store.get(down.service.available)).toBe(false);
    expect(await down.service.lookup(QUERY, PREFS)).toBeUndefined();
    down.service.store(QUERY, PREFS, FOUND);
    await flush();
    expect(down.request).not.toHaveBeenCalled();
  });
});

describe('歌词缓存的上限与占用', () => {
  it('连上后把上限告诉本地服务；改上限立即推；重新连上再推一次', async () => {
    const env = setup({
      [LYRICS_CACHE_PREF_KEY]: { version: 1, remember: true, enabled: true, limitMb: 20 },
    });
    env.on('/lyrics/limit', () => ({ success: true }));
    await env.service.ready;
    await flush();
    expect(env.calls('/lyrics/limit')).toEqual([['/lyrics/limit', { bytes: 20 * 1024 * 1024 }]]);
    await env.service.setLimit(200);
    expect(env.calls('/lyrics/limit').at(-1)).toEqual([
      '/lyrics/limit',
      { bytes: 200 * 1024 * 1024 },
    ]);
    env.store.set(env.port, null);
    await flush();
    expect(env.calls('/lyrics/limit')).toHaveLength(2);
    env.store.set(env.port, 5555);
    await flush();
    expect(env.calls('/lyrics/limit')).toHaveLength(3);
  });

  it('读占用：成功给条数与字节，失败如实标出；清理后重读', async () => {
    const env = setup();
    await env.service.ready;
    env.on('/lyrics/stats', () => ({ count: 3, bytes: 3 * 1024 * 1024 }));
    await env.service.refreshUsage();
    expect(env.store.get(env.service.usage)).toEqual({
      status: 'ready',
      count: 3,
      bytes: 3 * 1024 * 1024,
    });
    env.on('/lyrics/stats', () => ({ count: 'x' }));
    await env.service.refreshUsage();
    expect(env.store.get(env.service.usage)).toEqual({ status: 'failed' });
    env.on('/lyrics/clear', () => ({ success: true }));
    env.on('/lyrics/stats', () => ({ count: 0, bytes: 0 }));
    expect(await env.service.clear()).toBe(true);
    expect(env.store.get(env.service.usage)).toEqual({ status: 'ready', count: 0, bytes: 0 });
    env.on('/lyrics/clear', () => {
      throw new Error('拒绝');
    });
    expect(await env.service.clear()).toBe(false);
    expect(env.store.get(env.service.usage)).toEqual({ status: 'clear-failed' });
  });
});
