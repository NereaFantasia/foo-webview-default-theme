import { describe, expect, it } from 'vitest';
import { requestLastfmPage } from '../../../../../src/library/biography/online/lastfmPageFetch.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

function reply(status: number, headers: Record<string, string> = {}, body = '') {
  return { success: true as const, status, headers, body, responseType: 'text' as const };
}

const SIMPLIFIED = 'https://www.last.fm/zh/music/%E5%91%A8%E6%9D%B0%E4%BC%A6/+wiki';
const CANONICAL = 'https://www.last.fm/zh/music/%E5%91%A8%E6%9D%B0%E5%80%AB/+wiki';

describe('Last.fm 网页跟随', () => {
  it('名字规范化跳转跟到终页，交出终跳地址与规范名', async () => {
    const host = installFakeHost();
    host.answer('http.get', (params) =>
      String(params['url']).includes('%E4%BC%A6')
        ? reply(301, { Location: '/zh/music/%E5%91%A8%E6%9D%B0%E5%80%AB/+wiki' })
        : reply(200),
    );
    await expect(requestLastfmPage(SIMPLIFIED, host.fb)).resolves.toMatchObject({
      ok: true,
      finalUrl: CANONICAL,
      finalArtist: '周杰倫',
    });
    expect(host.callsTo('http.get').map((call) => call['url'])).toEqual([SIMPLIFIED, CANONICAL]);
    expect(host.callsTo('http.get')[0]).toMatchObject({ redirect: 'manual' });
  });

  it('没有跳转时原样交出，艺人名按 +wiki、主页、+images 三种尾巴认', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(200));
    const base = 'https://www.last.fm/music/%E5%91%A8%E6%9D%B0%E5%80%AB';
    for (const [url, name] of [
      [`${base}/+wiki`, '周杰倫'],
      [base, '周杰倫'],
      [`${base}/+images`, '周杰倫'],
      ['https://www.last.fm/music/Queen/+images', 'Queen'],
    ] as const) {
      await expect(requestLastfmPage(url, host.fb)).resolves.toMatchObject({
        ok: true,
        finalUrl: url,
        finalArtist: name,
      });
    }
  });

  it('403、404 照样交出，归类留给调用方', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(403));
    await expect(requestLastfmPage(SIMPLIFIED, host.fb)).resolves.toMatchObject({
      ok: true,
      answer: { status: 403 },
    });
    host.answer('http.get', reply(404));
    await expect(requestLastfmPage(SIMPLIFIED, host.fb)).resolves.toMatchObject({
      ok: true,
      answer: { status: 404 },
    });
  });

  it('跳外站、缺 Location、超过跳数上限都判失败', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(301, { Location: 'https://evil.example/x' }));
    await expect(requestLastfmPage(SIMPLIFIED, host.fb)).resolves.toMatchObject({ ok: false });
    host.answer('http.get', reply(301, {}));
    await expect(requestLastfmPage(SIMPLIFIED, host.fb)).resolves.toMatchObject({ ok: false });

    // 链式同站跳转超过上限
    host.answer('http.get', (params) => {
      const url = String(params['url']);
      const hop = url.includes('hop=3') ? null : Number(/hop=(\d)/.exec(url)?.[1] ?? 0) + 1;
      if (hop === null) return reply(200);
      const base = `https://www.last.fm/music/Queen?hop=${hop}`;
      return reply(301, { Location: base });
    });
    await expect(
      requestLastfmPage('https://www.last.fm/music/Queen', host.fb),
    ).resolves.toMatchObject({
      ok: false,
    });
    expect(host.callsTo('http.get').length).toBeLessThanOrEqual(3 + 3 + 3);
  });

  it('传输失败原样带出宿主原文', async () => {
    const host = installFakeHost();
    host.answer('http.get', hostFailure('OPERATION_FAILED', 'Send failed: DNS name not resolved'));
    await expect(requestLastfmPage(SIMPLIFIED, host.fb)).resolves.toEqual({
      ok: false,
      failure: { text: 'Send failed: DNS name not resolved', code: null },
    });
  });
});
