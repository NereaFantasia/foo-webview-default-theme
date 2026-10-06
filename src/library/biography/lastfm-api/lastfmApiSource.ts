import { fb } from 'foo-webview-sdk/bridge';
import {
  lastfmArtistUrl,
  type BiographyLanguage,
  type BiographyProblem,
} from '../biographyModel.ts';
import {
  fetchLastfmDetails,
  type LastfmDetailsFetchResult,
} from '../details/fetchLastfmDetails.ts';
import { fetchLastfmBiography, type LastfmFetchResult } from '../fetchLastfmBiography.ts';
import { readLastfmArtistInfo } from './lastfmArtistInfo.ts';
import { requestLastfmApi, type LastfmApiResult } from './lastfmApi.ts';

/** 网页这几种失败短时间内不会好：照片记成没有，等缓存过期再试；其余的下次取资料时重试。 */
const LASTING: readonly BiographyProblem[] = ['invalid', 'blocked'];

export interface LastfmSource {
  fetchText(artist: string, language: BiographyLanguage): Promise<LastfmFetchResult>;
  fetchDetails(artist: string, language: BiographyLanguage): Promise<LastfmDetailsFetchResult>;
}

/**
 * 填了 key 走 Last.fm API，没填走网页采集。API 的一次 `artist.getInfo` 同时有正文与附加资料，
 * 而服务先取正文、再按需取资料：取正文的那次应答留给紧随其后取资料的那次用，用过即丢，
 * 所以主动刷新总会重新请求。API 不给艺人照片，照片仍从网页主页取。
 */
export function createLastfmSource(
  apiKey: () => string,
  host: Pick<typeof fb, 'http'> = fb,
  request: typeof requestLastfmApi = requestLastfmApi,
  web: { text: typeof fetchLastfmBiography; details: typeof fetchLastfmDetails } = {
    text: fetchLastfmBiography,
    details: fetchLastfmDetails,
  },
): LastfmSource {
  let kept: { readonly id: string; readonly answer: Promise<LastfmApiResult> } | null = null;

  function info(key: string, artist: string, language: BiographyLanguage, keep: boolean) {
    const id = JSON.stringify([key, artist, language]);
    if (!keep && kept?.id === id) {
      const { answer } = kept;
      kept = null;
      return answer;
    }
    const answer = request(
      'artist.getInfo',
      { artist, lang: language, autocorrect: '0' },
      key,
      host,
    );
    kept = keep ? { id, answer } : null;
    return answer;
  }

  function read(result: LastfmApiResult, artist: string, language: BiographyLanguage) {
    return result.kind === 'data' ? readLastfmArtistInfo(result.data, artist, language) : null;
  }

  return {
    async fetchText(artist, language) {
      const key = apiKey();
      if (!key) return web.text(artist, language, host);
      const result = await info(key, artist, language, true);
      if (result.kind === 'failed')
        return { ok: false, problem: result.problem, retryAt: result.retryAt };
      const parsed = read(result, artist, language);
      const now = Date.now();
      if (result.kind === 'data' && !parsed)
        return { ok: false, problem: 'invalid', retryAt: now + 5 * 60_000 };
      return {
        ok: true,
        store: result.store,
        entry: {
          artist,
          language,
          fetchedAt: now,
          // no-cache 时有效期算在发请求那一刻，不能早于取到的时间，否则缓存读回时作废。
          expiresAt: Math.max(now, result.expiresAt),
          document: parsed?.document ?? null,
        },
      };
    },
    async fetchDetails(artist, language) {
      const key = apiKey();
      if (!key) return web.details(artist, language, host);
      const result = await info(key, artist, language, false);
      if (result.kind === 'failed')
        return { ok: false, problem: result.problem, retryAt: result.retryAt };
      const parsed = read(result, artist, language);
      if (result.kind === 'data' && !parsed)
        return { ok: false, problem: 'invalid', retryAt: Date.now() + 5 * 60_000 };
      const page = await web.details(artist, language, host);
      const now = Date.now();
      const photo = page.ok
        ? { photo: page.details.photo ?? null }
        : LASTING.includes(page.problem)
          ? { photo: null }
          : {};
      return {
        ok: true,
        store: result.store,
        details: {
          artist,
          language,
          url: lastfmArtistUrl(artist, language),
          fetchedAt: now,
          expiresAt: Math.max(now, result.expiresAt),
          ...(parsed?.details ?? { tags: [], counters: [], similar: [] }),
          ...photo,
        },
      };
    },
  };
}
