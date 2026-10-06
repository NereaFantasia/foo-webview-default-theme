import { lastfmArtistFromUrl, lastfmArtistUrl, type BiographyLanguage } from '../biographyModel.ts';

export interface LastfmPhoto {
  readonly url: string;
  readonly pageUrl: string;
}

export function lastfmPhotoId(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'lastfm-img.freetls.fastly.net' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    const match = /^\/i\/u\/(?:ar0|\d+x\d+(?:s)?)\/([a-f0-9]{32})\.(?:jpg|png|webp)$/.exec(
      url.pathname,
    );
    const id = match?.[1];
    return id && id !== '2a96cbd8b46e442fc41c2b86b821562f' ? id : null;
  } catch {
    return null;
  }
}

export function readLastfmPhotoValue(
  value: unknown,
  artist: string,
  language: BiographyLanguage,
): LastfmPhoto | null {
  if (typeof value !== 'object' || value === null) return null;
  const url: unknown = Reflect.get(value, 'url');
  const pageUrl: unknown = Reflect.get(value, 'pageUrl');
  const id = typeof url === 'string' ? lastfmPhotoId(url) : null;
  return typeof url === 'string' &&
    id &&
    pageUrl === `${lastfmArtistUrl(artist, language)}/+images/${id}`
    ? { url, pageUrl }
    : null;
}

export function readLastfmPhoto(
  root: ParentNode,
  artist: string,
  language: BiographyLanguage,
): LastfmPhoto | null {
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (!canonical || lastfmArtistFromUrl(canonical)?.toLowerCase() !== artist.toLowerCase())
    return null;
  const candidates = [
    root.querySelector('.header-new-background-image[itemprop="image"]')?.getAttribute('content'),
    root.querySelector('meta[property="og:image"]')?.getAttribute('content'),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const id = lastfmPhotoId(candidate);
    if (!id) continue;
    // 主图必须同时有属于该艺人的照片页链接，不能误取站点图标或推荐艺人的图片。
    for (const link of root.querySelectorAll('a[href*="/+images/"]')) {
      if (link.closest('[hidden],[aria-hidden="true"],template')) continue;
      try {
        const page = new URL(link.getAttribute('href') ?? '', canonical);
        const suffix = `/+images/${id}`;
        if (
          page.protocol !== 'https:' ||
          page.hostname !== 'www.last.fm' ||
          page.port ||
          page.username ||
          page.password ||
          page.search ||
          page.hash ||
          !page.pathname.endsWith(suffix)
        )
          continue;
        const owner = lastfmArtistFromUrl(
          `${page.origin}${page.pathname.slice(0, -suffix.length)}`,
        );
        if (owner?.toLowerCase() === artist.toLowerCase())
          return { url: candidate, pageUrl: `${lastfmArtistUrl(artist, language)}${suffix}` };
      } catch {
        continue;
      }
    }
  }
  return null;
}
