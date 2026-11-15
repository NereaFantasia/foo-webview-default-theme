import { describe, expect, it } from 'vitest';
import {
  APPLE_API_BUDGET,
  APPLE_API_WINDOW_MS,
  APPLE_PAGE_INTERVAL_MS,
  PREFETCH_KEEP_MS,
  createAppleClient,
} from '../../../../../src/library/biography/apple/appleClient.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

function reply(status: number, body: string, headers: Record<string, string> = {}) {
  return { success: true as const, status, headers, body, responseType: 'text' as const };
}

function clock() {
  let time = 1_000_000;
  const waits: number[] = [];
  return {
    now: () => time,
    wait: async (ms: number) => {
      waits.push(ms);
      time += ms;
    },
    waits,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const PAGE = 'https://music.apple.com/cn/artist/queen/3296287';

/** 客户端的时钟与等待要来自同一个时钟，等待才会推进它读到的时间 */
function clientOf(host: ReturnType<typeof installFakeHost>) {
  const time = clock();
  return createAppleClient(host.fb, time.now, time.wait);
}

describe('Apple 请求：iTunes 搜索与 Lookup', () => {
  it('搜索用 cn 区，中文搜索词百分号编码，不跟随跳转', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(200, '{"results":[]}'));
    const client = clientOf(host);
    expect(await client.search('陈奕迅')).toEqual({ kind: 'data', data: { results: [] } });
    const call = host.callsTo('http.get')[0];
    expect(call).toMatchObject({ redirect: 'error', timeout: 15000 });
    const url = new URL(String(call?.['url']));
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search');
    expect(url.search).toContain('%E9%99%88%E5%A5%95%E8%BF%85');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      term: '陈奕迅',
      entity: 'musicArtist',
      country: 'cn',
      limit: '20',
    });
  });

  it('界面是英文时搜索多带 lang=en_us，曲风名才是英文；中文不带，其余参数不变', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(200, '{"results":[]}'));
    const client = clientOf(host);
    await client.search('Queen', undefined, 'en');
    await client.search('Queen', undefined, 'zh');
    const [english, chinese] = host.callsTo('http.get').map((call) => {
      return new URL(String(call['url'])).searchParams;
    });
    expect(Object.fromEntries(english ?? [])).toEqual({
      term: 'Queen',
      entity: 'musicArtist',
      country: 'cn',
      limit: '20',
      lang: 'en_us',
    });
    expect(chinese?.has('lang')).toBe(false);
  });

  it('Lookup 一次带上全部候选的 ID，按专辑取，limit 按每位艺人各算', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(200, '{"results":[]}'));
    const client = clientOf(host);
    await client.lookup(['112018', '256176428']);
    const url = new URL(String(host.callsTo('http.get')[0]?.['url']));
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/lookup');
    expect(url.searchParams.get('id')).toBe('112018,256176428');
    expect(url.searchParams.get('entity')).toBe('album');
    expect(url.searchParams.get('country')).toBe('cn');
    expect(url.searchParams.get('limit')).toBe('200');
  });

  it('搜索与 Lookup 合计每分钟最多 15 次，满了等到最早那次满一分钟再发', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(200, '{}'));
    const time = clock();
    const client = createAppleClient(host.fb, time.now, time.wait);
    const terms = Array.from({ length: APPLE_API_BUDGET + 1 }, (_, index) => `a${index}`);
    await Promise.all(terms.map((term) => client.search(term)));
    expect(host.callsTo('http.get')).toHaveLength(APPLE_API_BUDGET + 1);
    expect(time.waits).toEqual([APPLE_API_WINDOW_MS]);
  });

  it('窗口过去后额度恢复，不再等待', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(200, '{}'));
    const time = clock();
    const client = createAppleClient(host.fb, time.now, time.wait);
    for (let index = 0; index < APPLE_API_BUDGET; index += 1) await client.search(`a${index}`);
    time.advance(APPLE_API_WINDOW_MS + 1);
    await client.search('later');
    expect(time.waits).toEqual([]);
  });

  it('同一个请求在途时共用一次；排到时调用方都已放弃就不发', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(200, '{}'));
    const client = clientOf(host);
    const results = await Promise.all([
      client.search('same'),
      client.search('same'),
      client.search('gone', () => false),
    ]);
    expect(results.map((item) => item.kind)).toEqual(['data', 'data', 'failed']);
    expect(host.callsTo('http.get')).toHaveLength(1);
  });

  it('429 限流退 60 秒，403 拒绝退 15 分钟，坏 JSON 算读不出，5xx 与传输失败算断网', async () => {
    const cases = [
      [reply(429, ''), { kind: 'failed', problem: 'rateLimited' }],
      [reply(403, ''), { kind: 'failed', problem: 'blocked' }],
      [reply(200, '<html>'), { kind: 'failed', problem: 'invalid' }],
      [reply(502, ''), { kind: 'failed', problem: 'network' }],
      [hostFailure('OPERATION_FAILED'), { kind: 'failed', problem: 'network' }],
    ] as const;
    for (const [answer, expected] of cases) {
      const host = installFakeHost();
      host.answer('http.get', answer);
      const time = clock();
      const result = await createAppleClient(host.fb, time.now, time.wait).search('x');
      expect(result).toMatchObject(expected);
      if (result.kind === 'failed') expect(result.retryAt).toBeGreaterThan(time.now());
    }
    const host = installFakeHost();
    host.answer('http.get', reply(429, ''));
    const time = clock();
    const limited = await createAppleClient(host.fb, time.now, time.wait).search('x');
    expect(limited).toMatchObject({ retryAt: time.now() + 60_000 });
  });

  it('服务端给了 Retry-After 就不早于它', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(429, '', { 'Retry-After': '600' }));
    const time = clock();
    const result = await createAppleClient(host.fb, time.now, time.wait).search('x');
    expect(result).toMatchObject({ retryAt: time.now() + 600_000 });
  });
});

describe('Apple 请求：艺人页', () => {
  it('超时 30 秒，手动跟随跳转；规范地址的跳转跟到 200 为止', async () => {
    const host = installFakeHost();
    const canonical = `${PAGE}?l=en-GB`;
    host.answer('http.get', (params) => {
      const url = String(params['url']);
      if (url === `${PAGE}?l=en-US`) return reply(301, '', { Location: canonical });
      return reply(200, '<html>ok</html>');
    });
    const client = clientOf(host);
    expect(await client.page(`${PAGE}?l=en-US`)).toEqual({
      kind: 'page',
      html: '<html>ok</html>',
      finalUrl: canonical,
    });
    const calls = host.callsTo('http.get');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ redirect: 'manual', timeout: 30000 });
  });

  it('相对地址的跳转按当前页解析；跳到外站、跳转太多都算失败', async () => {
    const host = installFakeHost();
    host.answer('http.get', (params) => {
      const url = String(params['url']);
      if (url.endsWith('/cn/artist/-/1')) return reply(301, '', { Location: '/cn/artist/a/1' });
      if (url.endsWith('/cn/artist/a/1')) return reply(200, 'x');
      if (url.endsWith('/offsite')) return reply(302, '', { Location: 'https://evil.test/x' });
      return reply(302, '', { Location: `${url}x` });
    });
    const client = clientOf(host);
    expect(await client.page('https://music.apple.com/cn/artist/-/1')).toMatchObject({
      kind: 'page',
      finalUrl: 'https://music.apple.com/cn/artist/a/1',
    });
    expect(await client.page('https://music.apple.com/offsite')).toMatchObject({
      kind: 'failed',
      problem: 'network',
    });
    expect(await client.page('https://music.apple.com/loop')).toMatchObject({
      kind: 'failed',
      problem: 'network',
    });
  });

  it('404 是没有这页，429、403 与传输失败归类，页面太大算读不出', async () => {
    const cases = [
      [reply(404, ''), { kind: 'missing' }],
      [reply(429, ''), { kind: 'failed', problem: 'rateLimited' }],
      [reply(403, ''), { kind: 'failed', problem: 'blocked' }],
      [reply(500, ''), { kind: 'failed', problem: 'network' }],
      [hostFailure('OPERATION_FAILED'), { kind: 'failed', problem: 'network' }],
      [reply(200, 'x'.repeat(2_000_001)), { kind: 'failed', problem: 'invalid' }],
    ] as const;
    for (const [answer, expected] of cases) {
      const host = installFakeHost();
      host.answer('http.get', answer);
      const client = clientOf(host);
      expect(await client.page(PAGE)).toMatchObject(expected);
    }
  });

  it('页面请求之间至少隔 3 秒，且不占搜索的额度', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(200, 'x'));
    const time = clock();
    const client = createAppleClient(host.fb, time.now, time.wait);
    await Promise.all([client.page(`${PAGE}?a=1`), client.page(`${PAGE}?a=2`), client.search('s')]);
    expect(time.waits).toEqual([APPLE_PAGE_INTERVAL_MS]);
    expect(host.callsTo('http.get')).toHaveLength(3);
  });
});

describe('Apple 请求：提前取艺人页', () => {
  function pageHost() {
    const host = installFakeHost();
    let version = 0;
    host.answer('http.get', () => {
      version += 1;
      return reply(200, `page ${version}`);
    });
    return host;
  }

  it('取页时认领提前取的结果，不再发请求；认领一次就没了，下一次是新的请求', async () => {
    const host = pageHost();
    const client = clientOf(host);
    client.prefetch(PAGE);
    expect(await client.page(PAGE)).toMatchObject({ kind: 'page', html: 'page 1' });
    expect(host.callsTo('http.get')).toHaveLength(1);
    expect(await client.page(PAGE)).toMatchObject({ kind: 'page', html: 'page 2' });
    expect(host.callsTo('http.get')).toHaveLength(2);
  });

  it('留得太久没人认领就丢，刷新不会拿到过时的页面', async () => {
    const host = pageHost();
    const time = clock();
    const client = createAppleClient(host.fb, time.now, time.wait);
    client.prefetch(PAGE);
    // 等提前取的请求落地，再让它过期
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.callsTo('http.get')).toHaveLength(1);
    time.advance(PREFETCH_KEEP_MS + 1);
    expect(await client.page(PAGE)).toMatchObject({ html: 'page 2' });
    expect(host.callsTo('http.get')).toHaveLength(2);
  });

  it('提前取的那次因调用方放弃没发出去时，取页自己发；失败原样交出，不重发', async () => {
    const host = pageHost();
    const client = clientOf(host);
    client.prefetch(PAGE, () => false);
    expect(await client.page(PAGE)).toMatchObject({ kind: 'page', html: 'page 1' });
    expect(host.callsTo('http.get')).toHaveLength(1);

    const limited = installFakeHost();
    limited.answer('http.get', reply(429, ''));
    const other = clientOf(limited);
    other.prefetch(PAGE);
    expect(await other.page(PAGE)).toMatchObject({ kind: 'failed', problem: 'rateLimited' });
    expect(limited.callsTo('http.get')).toHaveLength(1);
  });

  it('提前取的是另一个地址时不相干：照常发自己的请求', async () => {
    const host = pageHost();
    const client = clientOf(host);
    client.prefetch(`${PAGE}?l=en-GB`);
    await client.page(PAGE);
    expect(host.callsTo('http.get')).toHaveLength(2);
  });
});
