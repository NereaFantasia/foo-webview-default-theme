import { describe, expect, it } from 'vitest';
import type {
  AppleClient,
  ApplePageAnswer,
} from '../../../../../src/library/biography/apple/appleClient.ts';
import {
  appleFirstPageUrl,
  fetchAppleBiography,
} from '../../../../../src/library/biography/apple/fetchAppleBiography.ts';
import { BIOGRAPHY_DEFAULT_TTL } from '../../../../../src/library/biography/biographyModel.ts';
import {
  APPLE_EN_BIO,
  APPLE_HLS_SQUARE,
  APPLE_ID,
  APPLE_PAGE_URL,
  APPLE_THUMB,
  appleLinked,
  applePageHtml,
} from '../../../../fixtures/applePages.ts';

const JAPANESE =
  '米津玄師は、ボカロPハチとして活動を始め、独自の音楽を作り続けているアーティスト。'.repeat(3);
const SUBJECT = { id: APPLE_ID, name: 'Queen', url: APPLE_PAGE_URL };

/** 按请求地址答页面的客户端替身，记下每次请求的地址 */
function pages(answers: (url: string) => ApplePageAnswer) {
  const requested: string[] = [];
  const client: Pick<AppleClient, 'page'> = {
    page: async (url) => {
      requested.push(url);
      return answers(url);
    },
  };
  return { client, requested };
}

const page = (html: string): ApplePageAnswer => ({ kind: 'page', html, finalUrl: APPLE_PAGE_URL });
const bioPage = page(applePageHtml());
const bareHtml = applePageHtml({ linked: appleLinked({ description: '', genre: ['Pop'] }) });
const barePage = page(bareHtml);

describe('取 Apple 简介', () => {
  it('zh 取默认语言的页面一次：简介、署名、曲风、艺术照、艺术字与动态艺术照一起交出', async () => {
    const env = pages(() => bioPage);
    const result = await fetchAppleBiography(env.client, SUBJECT, 'zh');
    expect(env.requested).toEqual([APPLE_PAGE_URL]);
    if (!result.ok) throw new Error('expected a result');
    expect(result.store).toBe(true);
    expect(result.entry).toMatchObject({
      source: 'apple',
      sourceId: APPLE_ID,
      artist: 'Queen',
      language: 'zh',
    });
    expect(result.entry.document).toMatchObject({
      source: 'apple',
      sourceId: APPLE_ID,
      language: 'zh',
      textLanguage: 'en',
      paragraphs: [APPLE_EN_BIO],
      url: APPLE_PAGE_URL,
      attribution: { name: 'Apple Music', url: APPLE_PAGE_URL },
      // Queen 没有 wideArtwork，宽幅动态艺术照的静帧当宽幅图，整图不裁
      photo: {
        source: 'apple',
        url: APPLE_THUMB,
        pageUrl: APPLE_PAGE_URL,
        wide: { url: APPLE_THUMB, crop: 'bb' },
      },
      logo: { width: 2930, height: 958 },
      motion: { square: { video: APPLE_HLS_SQUARE } },
    });
    expect(result.entry.document).not.toHaveProperty('license');
    expect(result.entry.details).toMatchObject({
      source: 'apple',
      tags: ['Rock'],
      counters: [],
      similar: [],
    });
  });

  it('提前取页用的地址就是取简介时第一个请求的地址：zh 取原址，en 先取 en-GB；没有身份记下的地址时按 ID 跳转', async () => {
    for (const language of ['zh', 'en'] as const) {
      const env = pages(() => bioPage);
      await fetchAppleBiography(env.client, SUBJECT, language);
      expect(appleFirstPageUrl(SUBJECT, language)).toBe(env.requested[0]);
    }
    const bare = pages(() => bioPage);
    await fetchAppleBiography(bare.client, { id: APPLE_ID, name: 'Queen' }, 'zh');
    expect(appleFirstPageUrl({ id: APPLE_ID, name: 'Queen' }, 'zh')).toBe(bare.requested[0]);
  });

  it('有效期固定 28 天，不照页面响应头', async () => {
    const env = pages(() => bioPage);
    const before = Date.now();
    const result = await fetchAppleBiography(env.client, SUBJECT, 'zh');
    if (!result.ok) throw new Error('expected a result');
    expect(result.entry.expiresAt - result.entry.fetchedAt).toBe(BIOGRAPHY_DEFAULT_TTL);
    expect(result.entry.fetchedAt).toBeGreaterThanOrEqual(before);
  });

  it('zh 没有真简介时只请求这一次，简介记为没有，页面里的曲风仍交出；回退到 en 是服务的事', async () => {
    const env = pages(() => barePage);
    const result = await fetchAppleBiography(env.client, SUBJECT, 'zh');
    expect(env.requested).toHaveLength(1);
    if (!result.ok) throw new Error('expected a result');
    expect(result.entry.document).toBeNull();
    expect(result.entry.details).toMatchObject({ tags: ['Pop'] });
  });

  it('en 直接取 ?l=en-GB（en-US 会 301 到它，省一跳），有简介就不再取默认语言的页面', async () => {
    const env = pages(() => bioPage);
    const result = await fetchAppleBiography(env.client, SUBJECT, 'en');
    expect(env.requested).toHaveLength(1);
    expect(new URL(env.requested[0] ?? '').searchParams.get('l')).toBe('en-GB');
    expect(result.ok && result.entry.document?.language).toBe('en');
  });

  it('从 zh 回落来的 en 只取英文页：默认语言的页面刚取过、没有简介，不取第二遍', async () => {
    const env = pages(() => barePage);
    const result = await fetchAppleBiography(env.client, SUBJECT, 'en', true);
    expect(env.requested).toEqual([`${APPLE_PAGE_URL}?l=en-GB`]);
    expect(result.ok && result.entry.document).toBeNull();
    expect(result.ok && result.entry.details?.tags).toEqual(['Pop']);
  });

  it('en 的英文页没有简介时改取默认语言的页面，文字可能是原文，语言按内容标', async () => {
    const japanese = page(applePageHtml({ linked: appleLinked({ description: JAPANESE }) }));
    const env = pages((url) => (new URL(url).searchParams.has('l') ? barePage : japanese));
    const result = await fetchAppleBiography(env.client, SUBJECT, 'en');
    expect(env.requested).toHaveLength(2);
    expect(new URL(env.requested[1] ?? '').searchParams.has('l')).toBe(false);
    if (!result.ok) throw new Error('expected a result');
    expect(result.entry.language).toBe('en');
    expect(result.entry.document).toMatchObject({ language: 'en', textLanguage: 'ja' });
  });

  it('en 两页都没有简介：记为没有，用第一页的曲风', async () => {
    const env = pages(() => barePage);
    const result = await fetchAppleBiography(env.client, SUBJECT, 'en');
    expect(env.requested).toHaveLength(2);
    expect(result.ok && result.entry.document).toBeNull();
    expect(result.ok && result.entry.details?.tags).toEqual(['Pop']);
  });

  it('没有这一页（404）时记为没有，名字用认定时的显示名，没有附加资料', async () => {
    const env = pages(() => ({ kind: 'missing' }));
    const result = await fetchAppleBiography(env.client, { ...SUBJECT, name: ' Queen ' }, 'zh');
    expect(result.ok && result.entry).toMatchObject({ artist: 'Queen', document: null });
    expect(result.ok && result.entry.details).toBeUndefined();
  });

  it('没给页面地址时按 ID 取，页面会跳到规范地址', async () => {
    const env = pages(() => bioPage);
    await fetchAppleBiography(env.client, { id: APPLE_ID, name: 'Queen' }, 'zh');
    expect(env.requested).toEqual([`https://music.apple.com/cn/artist/-/${APPLE_ID}`]);
  });

  it('请求失败原样交出归类、重试时间和宿主原文，不改成没有简介', async () => {
    const env = pages(() => ({
      kind: 'failed',
      problem: 'rateLimited',
      retryAt: 42,
      detail: 'x',
    }));
    expect(await fetchAppleBiography(env.client, SUBJECT, 'en')).toEqual({
      ok: false,
      problem: 'rateLimited',
      retryAt: 42,
      detail: 'x',
    });
    expect(env.requested).toHaveLength(1);
  });

  it('页面读不出来，或页面属于别的艺人：算读不出，不缓存成没有', async () => {
    for (const html of [
      '<html></html>',
      applePageHtml({ id: '999' }),
      applePageHtml({ linked: null }),
    ]) {
      const env = pages(() => page(html));
      const result = await fetchAppleBiography(env.client, SUBJECT, 'zh');
      expect(result).toMatchObject({ ok: false, problem: 'invalid' });
    }
  });

  it('请求排到时调用方已放弃的标记会交给客户端', async () => {
    const seen: (() => boolean)[] = [];
    const client: Pick<AppleClient, 'page'> = {
      page: async (_url, alive) => {
        if (alive) seen.push(alive);
        return bioPage;
      },
    };
    const alive = () => false;
    await fetchAppleBiography(client, SUBJECT, 'zh', false, alive);
    expect(seen).toEqual([alive]);
  });
});
