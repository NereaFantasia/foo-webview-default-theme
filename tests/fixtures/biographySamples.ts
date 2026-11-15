import {
  lastfmAttribution,
  lastfmBiographyUrl,
  lastfmArtistUrl,
  type BiographyDocument,
  type BiographyFetchResult,
  type BiographyLanguage,
} from '../../src/library/biography/biographyModel.ts';
import { makeTrack } from './tracks.ts';

export function biographyLocalTracks(artist = 'Queen') {
  return [
    makeTrack({
      path: 'file://E:/Music/own-a.flac',
      artist,
      artists: [artist],
      album: 'Own',
      albumArtist: artist,
      duration: 600,
    }),
    makeTrack({
      path: 'file://E:/Music/own-b.flac',
      artist,
      artists: [artist, 'Guest'],
      album: 'Own',
      albumArtist: artist,
      duration: 1200,
    }),
    makeTrack({
      path: 'file://E:/Music/guest.flac',
      artist: 'Other',
      artists: ['Other', artist, 'Guest'],
      album: 'Guest album',
      albumArtist: 'Other',
      duration: 900,
    }),
  ].map((track, index) => ({ ...track, index }));
}

export function biographyDocument(
  artist = 'Queen',
  language: BiographyLanguage = 'zh',
  text = '第一段简介。\n\n第二段简介。',
): BiographyDocument {
  const license = { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' };
  return {
    source: 'lastfm',
    sourceId: artist,
    artist,
    language,
    paragraphs: text.split('\n\n'),
    url: lastfmBiographyUrl(artist, language),
    attribution: lastfmAttribution(artist, language, license),
    license: license.name,
    licenseUrl: license.url,
  };
}

export function biographyOverviewHtml(
  artist = 'Queen',
  language: BiographyLanguage = 'zh',
  content?: string,
): string {
  return `<!doctype html><html><head><link rel="canonical" href="${lastfmArtistUrl(artist, language)}"></head>
    <body><h1 class="header-new-title">${artist}</h1>${
      content ??
      `
    <ul><li class="tag"><a href="/tag/rock">rock</a></li><li class="tag"><a href="/tag/classic+rock">classic rock</a></li></ul>
    <div><h4 class="header-metadata-tnew-title">听众</h4><abbr class="intabbr js-abbreviated-counter" title="1,234,567">1.2M</abbr></div>
    <div><h4 class="header-metadata-tnew-title">播放次数</h4><abbr class="intabbr js-abbreviated-counter" title="9,876,543">9.9M</abbr></div>
    <h3 class="catalogue-overview-similar-artists-full-width-item-name"><a href="/music/David+Bowie">David Bowie</a></h3>
    <h3 class="catalogue-overview-similar-artists-full-width-item-name"><a href="/music/The%20Beatles">The Beatles</a></h3>`
    }</body></html>`;
}

export function biographyHtml(
  artist = 'Queen',
  body = '<p>第一段简介。</p><p>第二段简介。</p>',
  language: BiographyLanguage = 'zh',
): string {
  return `<!doctype html><html><head>
    <link rel="canonical" href="${lastfmBiographyUrl(artist, language)}">
    </head><body><div class="wiki-content">${body}</div>
    <div class="wiki-legal"><a href="http://creativecommons.org/licenses/by-sa/3.0/legalcode">
    Creative Commons Attribution-ShareAlike</a></div></body></html>`;
}

export function appleArtistUrl(id: string, slug = 'nirvana'): string {
  return `https://music.apple.com/cn/artist/${slug}/${id}`;
}

/** Apple 来源取数成功的结果：简介与曲风一起到，`text` 为空表示这一页没有简介 */
export function appleFetchResult(
  id: string,
  language: BiographyLanguage,
  text = 'A grunge band.',
  name = 'Nirvana',
): BiographyFetchResult {
  const url = appleArtistUrl(id);
  const now = Date.now();
  const expiresAt = now + 60_000;
  const document: BiographyDocument | null = text
    ? {
        source: 'apple',
        sourceId: id,
        artist: name,
        language,
        textLanguage: 'en',
        paragraphs: [text],
        url,
        attribution: { name: 'Apple Music', url },
      }
    : null;
  return {
    ok: true,
    store: true,
    entry: {
      source: 'apple',
      sourceId: id,
      artist: name,
      language,
      fetchedAt: now,
      expiresAt,
      document,
      details: {
        source: 'apple',
        artist: name,
        language,
        url,
        fetchedAt: now,
        expiresAt,
        tags: ['Rock'],
        counters: [],
        similar: [],
      },
    },
  };
}
