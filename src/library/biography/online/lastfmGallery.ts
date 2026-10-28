import { fb } from 'foo-webview-sdk/bridge';
import { classifyHostHttpFailure } from '../../../host/hostHttpFailure.ts';
import { biographyFreshness, biographyRetryAt } from '../biographyCacheFormat.ts';
import { lastfmArtistFromUrl } from '../biographyModel.ts';
import { lastfmPhotoId, type LastfmPhoto } from './lastfmPhoto.ts';
import { requestLastfmPage } from './lastfmPageFetch.ts';
import type { BiographyPhotoProblem } from './fetchLastfmPhoto.ts';

export const LASTFM_GALLERY_LIMIT = 24;
const PAGE_BYTES = 2_000_000;

export type LastfmGalleryResult =
  | {
      readonly ok: true;
      readonly photos: readonly LastfmPhoto[];
      readonly expiresAt: number;
      readonly store: boolean;
    }
  | {
      readonly ok: false;
      readonly problem: BiographyPhotoProblem;
      readonly retryAt: number;
      /** 传输或跟随跳转失败的原文；HTTP 层失败（403、429 等）没有 */
      readonly detail?: string | null;
    };

/**
 * 解析 +images 相册页。与页面内容比对用 `pageArtistUrl`（取到的那一页的地址，名字
 * 规范化跳转后是规范名页面），照片的来源链接保持 `artistUrl`（请求名）
 */
export function readLastfmGallery(
  html: string,
  artistUrl: string,
  pageArtistUrl: string = artistUrl,
): readonly LastfmPhoto[] | null {
  if (html.length > PAGE_BYTES) return null;
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const artist = lastfmArtistFromUrl(artistUrl);
  const pageArtist = lastfmArtistFromUrl(pageArtistUrl);
  if (!canonical || !artist || !pageArtist) return null;
  const owner = lastfmArtistFromUrl(canonical.replace(/\/\+images\/?$/, ''));
  if (owner?.toLowerCase() !== pageArtist.toLowerCase()) return null;
  const photos = new Map<string, LastfmPhoto>();
  for (const link of root.querySelectorAll('a[href*="/+images/"]')) {
    if (link.closest('[hidden],[aria-hidden="true"],template')) continue;
    try {
      const page = new URL(link.getAttribute('href') ?? '', canonical);
      const id = /\/\+images\/([a-f0-9]{32})$/.exec(page.pathname)?.[1];
      if (!id || page.search || page.hash || page.username || page.password || page.port) continue;
      const parent = lastfmArtistFromUrl(page.href.slice(0, -`/+images/${id}`.length));
      if (parent?.toLowerCase() !== pageArtist.toLowerCase()) continue;
      const image = link.querySelector('img');
      const url = image?.getAttribute('src') ?? image?.getAttribute('data-src');
      if (!url || lastfmPhotoId(url) !== id) continue;
      photos.set(id, {
        url: `https://lastfm-img.freetls.fastly.net/i/u/770x0/${id}.jpg`,
        pageUrl: `${artistUrl}/+images/${id}`,
      });
      if (photos.size >= LASTFM_GALLERY_LIMIT) break;
    } catch {
      continue;
    }
  }
  return photos.size || root.querySelector('.image-list, .image-list-item, .resource-images')
    ? [...photos.values()]
    : null;
}

export async function fetchLastfmGallery(
  artistUrl: string,
  host: Pick<typeof fb, 'http'> = fb,
): Promise<LastfmGalleryResult> {
  const fail = (
    problem: BiographyPhotoProblem,
    delay: number,
    headers: Record<string, string> = {},
    detail: string | null = null,
  ): LastfmGalleryResult => ({
    ok: false,
    problem,
    retryAt: biographyRetryAt(headers, Date.now(), delay),
    detail,
  });
  if (!lastfmArtistFromUrl(artistUrl)) return fail('invalid', 300_000);
  const page = await requestLastfmPage(`${artistUrl}/+images`, host);
  if (!page.ok)
    return fail(classifyHostHttpFailure(page.failure) ?? 'network', 30_000, {}, page.failure.text);
  const answer = page.answer;
  const headers = answer.headers ?? {};
  if (answer.status === 429) return fail('rateLimited', 60_000, headers);
  if (answer.status === 403) return fail('blocked', 900_000, headers);
  if (answer.status !== 200 && answer.status !== 404) return fail('network', 30_000, headers);
  const pageArtistUrl = page.finalUrl.replace(/\/\+images\/?$/, '') || artistUrl;
  const photos =
    answer.status === 404 ? [] : readLastfmGallery(answer.body ?? '', artistUrl, pageArtistUrl);
  if (!photos) return fail('invalid', 300_000, headers);
  return { ok: true, photos, ...biographyFreshness(headers, Date.now()) };
}
