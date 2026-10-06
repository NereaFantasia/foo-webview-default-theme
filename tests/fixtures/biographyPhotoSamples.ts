import { biographyHtml, biographyOverviewHtml } from './biographySamples.ts';

export const TAISHI_PHOTO_ID = '70bdc305cb8e9bc44837393a48202ca6';
export const TAISHI_PHOTO = {
  url: `https://lastfm-img.freetls.fastly.net/i/u/ar0/${TAISHI_PHOTO_ID}.jpg`,
  pageUrl: `https://www.last.fm/zh/music/Taishi/+images/${TAISHI_PHOTO_ID}`,
};

export function biographyPhotoHtml(artist = 'Taishi', wiki = false) {
  const html = wiki ? biographyHtml(artist) : biographyOverviewHtml(artist);
  return html
    .replace('</head>', `<meta property="og:image" content="${TAISHI_PHOTO.url}"></head>`)
    .replace(
      '</body>',
      `<div class="header-new-background-image" itemprop="image" content="${TAISHI_PHOTO.url}"></div>
      <a href="/zh/music/${encodeURIComponent(artist)}/+images/${TAISHI_PHOTO_ID}">照片</a></body>`,
    );
}
