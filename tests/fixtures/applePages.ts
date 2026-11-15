/** Apple 艺人页与 iTunes 应答的固定样本，照真实页面的结构裁剪 */

export const APPLE_ID = '3296287';
export const APPLE_PAGE_URL = `https://music.apple.com/cn/artist/queen/${APPLE_ID}`;
export const APPLE_THUMB = 'https://is1-ssl.mzstatic.com/image/thumb/Features115/v4/92/mza_1.png';
export const APPLE_LOGO = 'https://is1-ssl.mzstatic.com/image/thumb/kHc61lZyatgbQwRGiiug-A';
export const APPLE_HLS_SQUARE =
  'https://mvod.itunes.apple.com/itunes-assets/HLSMusic221/v4/cd/P1_default.m3u8';
export const APPLE_HLS_WIDE =
  'https://mvod.itunes.apple.com/itunes-assets/HLSMusic211/v4/71/P2_default.m3u8';
export const APPLE_EN_BIO =
  'For Queen, rock was merely a jumping-off point. Packing enough pomp and grandeur to make their name seem understated, they built high-octane pop songs out of parts boosted from classical music.';

export interface ApplePageOptions {
  readonly id?: string;
  readonly linked?: Record<string, unknown> | null;
  readonly header?: Record<string, unknown> | null;
  readonly serialized?: string;
}

export function appleLinked(extra: Record<string, unknown> = {}, id = APPLE_ID) {
  return {
    '@type': 'MusicGroup',
    name: 'Queen',
    description: APPLE_EN_BIO,
    image: `${APPLE_THUMB}/486x486bb.png`,
    genre: ['Rock'],
    url: `https://music.apple.com/cn/artist/queen/${id}?l=en-GB`,
    ...extra,
  };
}

export function appleHeader(extra: Record<string, unknown> = {}, id = APPLE_ID) {
  return {
    id,
    artistLogo: {
      dictionary: { url: `${APPLE_LOGO}/{w}x{h}{c}.{f}`, width: 2930, height: 958 },
    },
    videoArtwork: {
      dictionary: {
        motionArtistSquare1x1: {
          video: APPLE_HLS_SQUARE,
          previewFrame: { url: `${APPLE_THUMB}/{w}x{h}{c}.{f}` },
        },
      },
    },
    wideVideoArtwork: {
      dictionary: {
        motionArtistWide16x9: {
          video: APPLE_HLS_WIDE,
          previewFrame: { url: `${APPLE_THUMB}/{w}x{h}{c}.{f}` },
        },
      },
    },
    ...extra,
  };
}

/** 照真实页面的写法：JSON-LD 的标签属性不加引号，页面数据在 serialized-server-data 里 */
export function applePageHtml({
  id = APPLE_ID,
  linked = appleLinked({}, id),
  header = appleHeader({}, id),
  serialized,
}: ApplePageOptions = {}): string {
  const data =
    serialized ?? JSON.stringify({ data: [{ data: { sections: [{ items: [header] }] } }] });
  return [
    '<html><head><script>var x = 1;</script>',
    linked
      ? `<script id=schema:music-group type="application/ld+json">\n${JSON.stringify(linked)}\n</script>`
      : '',
    `<script type="application/json" id="serialized-server-data">${data}</script>`,
    '</head><body></body></html>',
  ].join('\n');
}
