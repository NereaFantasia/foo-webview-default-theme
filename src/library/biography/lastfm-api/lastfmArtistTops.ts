import { fb } from 'foo-webview-sdk/bridge';
import { biographyArtist, lastfmArtistFromUrl, type BiographyProblem } from '../biographyModel.ts';
import { biographyField } from '../details/biographyDetailsModel.ts';
import { requestLastfmApi } from './lastfmApi.ts';

export interface LastfmTopTrack {
  /** 从 1 起。 */
  readonly rank: number;
  readonly title: string;
  readonly plays: number;
  readonly listeners: number;
  readonly url: string;
}

export interface LastfmTopAlbum {
  readonly title: string;
  readonly plays: number;
  readonly url: string;
}

export interface LastfmSimilarArtist {
  readonly artist: string;
  /** Last.fm 给的相似度，0 到 1。 */
  readonly match: number;
  readonly url: string;
}

export interface LastfmTops {
  readonly tracks: readonly LastfmTopTrack[];
  readonly albums: readonly LastfmTopAlbum[];
  readonly similar: readonly LastfmSimilarArtist[];
  readonly expiresAt: number;
}

export const TOP_TRACK_LIMIT = 50;
export const TOP_ALBUM_LIMIT = 20;
export const SIMILAR_LIMIT = 20;

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Last.fm 的 JSON 由 XML 转来：只有一项时那一项是对象，不是数组。 */
function items(data: unknown, outer: string, inner: string): readonly unknown[] {
  const box = record(data) ? data[outer] : undefined;
  const list = record(box) ? box[inner] : undefined;
  return Array.isArray(list) ? list : record(list) ? [list] : [];
}

/** 次数有的是字符串（曲目）、有的是数字（专辑）。 */
function count(value: unknown): number {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

/** 链接要在 Last.fm 上；曲目与专辑的链接是 /music/<艺人>/... 下的页面，只认 HTTPS。 */
function lastfmUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ['www.last.fm', 'last.fm'].includes(url.hostname) &&
      !url.username
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function readTopTracks(data: unknown): readonly LastfmTopTrack[] {
  return items(data, 'toptracks', 'track').flatMap((item, at): LastfmTopTrack[] => {
    if (!record(item) || !biographyField(item['name'], 500)) return [];
    const url = lastfmUrl(item['url']);
    if (!url) return [];
    const attr = record(item['@attr']) ? item['@attr'] : {};
    const rank = count(attr['rank']) || at + 1;
    return [
      {
        rank,
        title: item['name'],
        plays: count(item['playcount']),
        listeners: count(item['listeners']),
        url,
      },
    ];
  });
}

export function readTopAlbums(data: unknown): readonly LastfmTopAlbum[] {
  return items(data, 'topalbums', 'album').flatMap((item): LastfmTopAlbum[] => {
    // 有的艺人的热门专辑里混着名字是 null 的条目，那不是一张专辑。
    if (!record(item) || !biographyField(item['name'], 500)) return [];
    if (/^\(?null\)?$/i.test(item['name'].trim())) return [];
    const url = lastfmUrl(item['url']);
    return url ? [{ title: item['name'], plays: count(item['playcount']), url }] : [];
  });
}

export function readSimilarArtists(data: unknown, self: string): readonly LastfmSimilarArtist[] {
  return items(data, 'similarartists', 'artist').flatMap((item): LastfmSimilarArtist[] => {
    if (!record(item) || typeof item['name'] !== 'string') return [];
    const artist = biographyArtist(item['name']);
    const url = lastfmUrl(item['url']);
    const linked = url ? lastfmArtistFromUrl(url) : null;
    if (!artist || !url || !linked || artist.toLowerCase() === self.toLowerCase()) return [];
    const match = Number(item['match']);
    return [{ artist, match: Number.isFinite(match) ? Math.min(1, Math.max(0, match)) : 0, url }];
  });
}

/**
 * 取一位的热门曲目、热门专辑与相似艺人，三个请求按顺序发。任一请求失败就整份失败、交回原因；
 * 查无此人当作三样都没有。有效期取三者里最早的。
 */
export async function fetchLastfmTops(
  artist: string,
  apiKey: string,
  host: Pick<typeof fb, 'http'> = fb,
  request: typeof requestLastfmApi = requestLastfmApi,
): Promise<
  | ({ readonly ok: true } & LastfmTops)
  | { readonly ok: false; readonly problem: BiographyProblem; readonly retryAt: number }
> {
  const base = { artist, autocorrect: '0' };
  const calls = [
    ['artist.getTopTracks', String(TOP_TRACK_LIMIT)],
    ['artist.getTopAlbums', String(TOP_ALBUM_LIMIT)],
    ['artist.getSimilar', String(SIMILAR_LIMIT)],
  ] as const;
  const data: unknown[] = [];
  let expiresAt = Infinity;
  for (const [method, limit] of calls) {
    const result = await request(method, { ...base, limit }, apiKey, host);
    if (result.kind === 'failed')
      return { ok: false, problem: result.problem, retryAt: result.retryAt };
    expiresAt = Math.min(expiresAt, result.expiresAt);
    data.push(result.kind === 'data' ? result.data : null);
  }
  return {
    ok: true,
    tracks: readTopTracks(data[0]),
    albums: readTopAlbums(data[1]),
    similar: readSimilarArtists(data[2], artist),
    expiresAt,
  };
}
