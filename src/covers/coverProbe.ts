/** 出错的封面地址再问一次的结论：真没有封面，或一时取不到。 */
export type CoverVerdict = 'missing' | 'transient';

/** 问一个出错的封面地址的状态；不会拒绝。 */
export type CoverProbe = (url: string) => Promise<CoverVerdict>;

/** 发请求的函数，签名同 `fetch`。 */
export type CoverRequest = (url: string, init: RequestInit) => Promise<Response>;

/**
 * 用 fetch 把出错的封面地址再取一次，读 HTTP 状态。`<img>` 只知道出错，宿主却分得开：没有封面答 404
 * （同时记进负缓存，再问当场就答），取图的工作队列满了或请求被取消答 503。404 判缺图；别的状态码与
 * 取不到（这个协议 fetch 不认、请求出错）一律算一时取不到，照旧退避重试。宿主登记 fb2k:// 协议时允许
 * 任意来源发请求，答复也都带 `Access-Control-Allow-Origin: *`，页面读得到状态码。只要状态、不要图：
 * 答复一到就撤掉正文。
 */
export function fetchCoverProbe(
  request: CoverRequest = (url, init) => fetch(url, init),
): CoverProbe {
  return async (url) => {
    try {
      const response = await request(url, { cache: 'no-store' });
      response.body?.cancel().catch(() => {});
      return response.status === 404 ? 'missing' : 'transient';
    } catch {
      return 'transient';
    }
  };
}
