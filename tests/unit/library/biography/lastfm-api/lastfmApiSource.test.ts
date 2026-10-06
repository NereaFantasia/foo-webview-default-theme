import { describe, expect, it, vi } from 'vitest';
import type { LastfmApiResult } from '../../../../../src/library/biography/lastfm-api/lastfmApi.ts';
import { createLastfmSource } from '../../../../../src/library/biography/lastfm-api/lastfmApiSource.ts';
import type { LastfmDetailsFetchResult } from '../../../../../src/library/biography/details/fetchLastfmDetails.ts';
import type { LastfmFetchResult } from '../../../../../src/library/biography/fetchLastfmBiography.ts';
import { TAISHI_PHOTO } from '../../../../fixtures/biographyPhotoSamples.ts';
import { artistInfoSample } from '../../../../fixtures/lastfmApiSamples.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const KEY = '0123456789abcdef0123456789abcdef';

function setup(key = KEY, page?: LastfmDetailsFetchResult) {
  const host = installFakeHost();
  let current = key;
  const request = vi.fn(async (): Promise<LastfmApiResult> => ({
    kind: 'data',
    data: artistInfoSample(),
    store: true,
    expiresAt: Date.now() + 60_000,
  }));
  const text = vi.fn(async (): Promise<LastfmFetchResult> => ({
    ok: false,
    problem: 'network',
    retryAt: 0,
  }));
  const details = vi.fn(
    async (): Promise<LastfmDetailsFetchResult> =>
      page ?? {
        ok: true,
        store: true,
        details: {
          artist: 'Nujabes',
          language: 'zh',
          url: 'https://www.last.fm/zh/music/Nujabes',
          fetchedAt: 0,
          expiresAt: 1,
          tags: ['from-page'],
          counters: [],
          similar: [],
          photo: TAISHI_PHOTO,
        },
      },
  );
  const source = createLastfmSource(() => current, host.fb, request, { text, details });
  return {
    source,
    request,
    text,
    details,
    setKey: (value: string) => {
      current = value;
    },
  };
}

describe('Last.fm 取数来源', () => {
  it('没填 key 时正文与资料都走网页采集，不调 API', async () => {
    const env = setup('');
    await env.source.fetchText('Nujabes', 'zh');
    await env.source.fetchDetails('Nujabes', 'zh');
    expect(env.text).toHaveBeenCalledWith('Nujabes', 'zh', expect.anything());
    expect(env.details).toHaveBeenCalledTimes(1);
    expect(env.request).not.toHaveBeenCalled();
  });

  it('填了 key 时一次 getInfo 供正文与紧随的资料，照片仍取网页，主动刷新重新请求', async () => {
    const env = setup();
    const text = await env.source.fetchText('Nujabes', 'zh');
    expect(env.request).toHaveBeenCalledWith(
      'artist.getInfo',
      { artist: 'Nujabes', lang: 'zh', autocorrect: '0' },
      KEY,
      expect.anything(),
    );
    expect(text).toMatchObject({
      ok: true,
      entry: { artist: 'Nujabes', language: 'zh', document: { license: 'CC BY-SA 3.0' } },
    });
    const details = await env.source.fetchDetails('Nujabes', 'zh');
    expect(env.request).toHaveBeenCalledTimes(1);
    expect(details).toMatchObject({
      ok: true,
      details: {
        url: 'https://www.last.fm/zh/music/Nujabes',
        tags: ['Hip-Hop', 'Jazz Rap'],
        photo: TAISHI_PHOTO,
      },
    });
    await env.source.fetchDetails('Nujabes', 'zh');
    await env.source.fetchText('Nujabes', 'zh');
    expect(env.request).toHaveBeenCalledTimes(3);
    env.setKey('');
    await env.source.fetchText('Nujabes', 'zh');
    expect(env.request).toHaveBeenCalledTimes(3);
    expect(env.text).toHaveBeenCalledTimes(1);
  });

  it('查无此人是没有正文，key 出错原样上报，艺人对不上算解析失败', async () => {
    const env = setup();
    env.request.mockResolvedValueOnce({ kind: 'missing', store: true, expiresAt: Date.now() });
    expect(await env.source.fetchText('Nujabes', 'zh')).toMatchObject({
      ok: true,
      entry: { document: null },
    });
    env.request.mockResolvedValueOnce({ kind: 'failed', problem: 'keyInvalid', retryAt: 9 });
    expect(await env.source.fetchText('Nujabes', 'zh')).toEqual({
      ok: false,
      problem: 'keyInvalid',
      retryAt: 9,
    });
    env.request.mockResolvedValueOnce({ kind: 'failed', problem: 'keySuspended', retryAt: 9 });
    expect(await env.source.fetchDetails('Nujabes', 'ja')).toMatchObject({
      ok: false,
      problem: 'keySuspended',
    });
    expect(await env.source.fetchText('Fat Jon', 'zh')).toMatchObject({
      ok: false,
      problem: 'invalid',
    });
  });

  it('no-cache 的有效期不早于取到的时间，缓存读回时不作废', async () => {
    const env = setup();
    const sent = Date.now() - 5000;
    env.request.mockResolvedValue({
      kind: 'data',
      data: artistInfoSample(),
      store: true,
      expiresAt: sent,
    });
    const text = await env.source.fetchText('Nujabes', 'zh');
    if (!text.ok) throw new Error('应当取到正文');
    expect(text.entry.expiresAt).toBeGreaterThanOrEqual(text.entry.fetchedAt);
  });

  it('网页取不到照片时：拒绝访问或解析失败记成没有，断网不记、下次再试', async () => {
    const blocked = setup(KEY, { ok: false, problem: 'blocked', retryAt: 0 });
    const kept = await blocked.source.fetchDetails('Nujabes', 'zh');
    expect(kept.ok && kept.details.photo).toBeNull();
    const offline = setup(KEY, { ok: false, problem: 'network', retryAt: 0 });
    const missing = await offline.source.fetchDetails('Nujabes', 'zh');
    expect(missing.ok && 'photo' in missing.details).toBe(false);
    expect(missing.ok && missing.details.tags).toEqual(['Hip-Hop', 'Jazz Rap']);
  });
});
