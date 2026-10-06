import { installFakeHost } from './unitHost.ts';

export interface LyricsReply {
  /** 缺省 200。 */
  readonly status?: number;
  readonly body: string;
}

/** 按 URL（origin 加 pathname）登记的应答；函数按完整 URL 现算。 */
export type LyricsRoutes = Readonly<Record<string, LyricsReply | ((url: URL) => LyricsReply)>>;

/**
 * 歌词在线来源的宿主替身：请求经真的 SDK 走 `http.get`，按地址应答，没登记的地址答 404。
 * `requests()` 按发出的顺序给出每次请求的 URL，`header(名)` 取那次请求带的头。
 */
export function installLyricsHttp(routes: LyricsRoutes) {
  const host = installFakeHost();
  host.answer('http.get', (params) => {
    const url = new URL(String(params['url']));
    const route = routes[url.origin + url.pathname];
    const reply = typeof route === 'function' ? route(url) : route;
    return {
      success: true,
      status: reply ? (reply.status ?? 200) : 404,
      headers: {},
      body: reply?.body ?? '',
      responseType: 'text',
    };
  });
  return {
    host: host.fb,
    requests: () =>
      host.callsTo('http.get').map((params) => ({
        url: new URL(String(params['url'])),
        header: (name: string): unknown => Reflect.get(Object(params['headers']), name),
      })),
  };
}

/** 回 JSON 应答。 */
export const json = (value: unknown, status = 200): LyricsReply => ({
  status,
  body: JSON.stringify(value),
});
