import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../../host/hostCall.ts';
import { biographyFreshness, biographyRetryAt } from '../biographyCacheFormat.ts';
import { lastfmArtistFromUrl } from '../biographyModel.ts';
import { lastfmPhotoId, type LastfmPhoto } from './lastfmPhoto.ts';
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
  | { readonly ok: false; readonly problem: BiographyPhotoProblem; readonly retryAt: number };

export function readLastfmGallery(html: string, artistUrl: string): readonly LastfmPhoto[] | null {
  if (html.length > PAGE_BYTES) return null;
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const artist = lastfmArtistFromUrl(artistUrl);
  if (!canonical || !artist) return null;
  const owner = lastfmArtistFromUrl(canonical.replace(/\/\+images\/?$/, ''));
  if (owner?.toLowerCase() !== artist.toLowerCase()) return null;
  const photos = new Map<string, LastfmPhoto>();
  for (const link of root.querySelectorAll('a[href*="/+images/"]')) {
    if (link.closest('[hidden],[aria-hidden="true"],template')) continue;
    try {
      const page = new URL(link.getAttribute('href') ?? '', canonical);
      const id = /\/\+images\/([a-f0-9]{32})$/.exec(page.pathname)?.[1];
      if (!id || page.search || page.hash || page.username || page.password || page.port) continue;
      const parent = lastfmArtistFromUrl(page.href.slice(0, -`/+images/${id}`.length));
      if (parent?.toLowerCase() !== artist.toLowerCase()) continue;
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
  ): LastfmGalleryResult => ({
    ok: false,
    problem,
    retryAt: biographyRetryAt(headers, Date.now(), delay),
  });
  if (!lastfmArtistFromUrl(artistUrl)) return fail('invalid', 300_000);
  const answer = await settle(() =>
    host.http.request(`${artistUrl}/+images`, {
      timeout: 12_000,
      redirect: 'error',
      headers: {
        'User-Agent': 'foo-webview-default-theme/0.1 (+https://github.com/NereaFantasia)',
        Accept: 'text/html',
      },
    }),
  );
  if (!answer) return fail('network', 30_000);
  const headers = answer.headers ?? {};
  if (answer.status === 429) return fail('rateLimited', 60_000, headers);
  if (answer.status === 403) return fail('blocked', 900_000, headers);
  if (answer.status !== 200 && answer.status !== 404) return fail('network', 30_000, headers);
  const photos = answer.status === 404 ? [] : readLastfmGallery(answer.body ?? '', artistUrl);
  if (!photos) return fail('invalid', 300_000, headers);
  return { ok: true, photos, ...biographyFreshness(headers, Date.now()) };
}
