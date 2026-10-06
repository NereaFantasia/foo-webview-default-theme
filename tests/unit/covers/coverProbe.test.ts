import { describe, expect, it } from 'vitest';
import { fetchCoverProbe, type CoverRequest } from '../../../src/covers/coverProbe.ts';

/** 答一个带正文的状态码，记下请求的参数与正文有没有被撤掉。 */
function answering(status: number) {
  const seen: { url: string; init: RequestInit }[] = [];
  let cancelled = false;
  const request: CoverRequest = (url, init) => {
    seen.push({ url, init });
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    return Promise.resolve(new Response(body, { status }));
  };
  return { request, seen, cancelled: () => cancelled };
}

describe('fetchCoverProbe', () => {
  it('404 判没有封面；请求绕开缓存，拿到答复就撤掉正文', async () => {
    const host = answering(404);
    await expect(fetchCoverProbe(host.request)('fb2k://artwork/?path=a')).resolves.toBe('missing');
    expect(host.seen).toEqual([{ url: 'fb2k://artwork/?path=a', init: { cache: 'no-store' } }]);
    expect(host.cancelled()).toBe(true);
  });

  it('503、500 与 200 都算一时取不到', async () => {
    for (const status of [503, 500, 200]) {
      await expect(fetchCoverProbe(answering(status).request)('u')).resolves.toBe('transient');
    }
  });

  it('请求出错（协议不认、网络错）也算一时取不到，不拒绝', async () => {
    const probe = fetchCoverProbe(() => Promise.reject(new TypeError('unknown scheme')));
    await expect(probe('fb2k://artwork/?path=a')).resolves.toBe('transient');
  });
});
