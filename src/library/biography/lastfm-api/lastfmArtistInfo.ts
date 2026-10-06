import {
  BIOGRAPHY_TEXT_LIMIT,
  biographyArtist,
  lastfmArtistFromUrl,
  lastfmArtistUrl,
  lastfmBiographyUrl,
  type BiographyDocument,
  type BiographyLanguage,
} from '../biographyModel.ts';
import {
  biographyField,
  type BiographyCounter,
  type BiographyDetails,
  type BiographyRelatedArtist,
} from '../details/biographyDetailsModel.ts';
import { matchBiographyLinks } from '../article/biographyLinks.ts';

/** Last.fm 用户撰写的正文按 CC BY-SA 3.0 发布，它的 wiki 页链的就是这一版。 */
const LICENSE = { url: 'https://creativecommons.org/licenses/by-sa/3.0/', name: 'CC BY-SA 3.0' };
/** 正文末尾的许可声明；许可由来源行另写，正文里不重复。 */
const LICENSE_TAIL =
  /\s*User-contributed text is available under the Creative Commons By-SA License; additional terms may apply\.?\s*$/i;
/** 正文末尾指回 Last.fm 的「Read more on Last.fm」；来源行已经链回原页。 */
const MORE_TAIL = /\s*<a\s[^>]*href="https?:\/\/(?:www\.)?last\.fm\/[^"]*"[^>]*>[^<]*<\/a>\.?\s*$/i;

export interface LastfmArtistInfo {
  readonly document: BiographyDocument | null;
  readonly details: Pick<BiographyDetails, 'tags' | 'counters' | 'similar'>;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Last.fm 的 JSON 由 XML 转来：只有一项时那一项是对象，不是数组。 */
function items(value: unknown, key: string): readonly unknown[] {
  const inner = record(value) ? value[key] : undefined;
  return Array.isArray(inner) ? inner : record(inner) ? [inner] : [];
}

/** API 给的链接里名字带「+」时编码了两次（%252B）：按网页规则解完还剩一层，再解一次后比较。 */
function linksTo(url: unknown, name: string): boolean {
  const linked = typeof url === 'string' ? lastfmArtistFromUrl(url) : null;
  if (!linked) return false;
  const target = name.toLowerCase();
  if (linked.toLowerCase() === target) return true;
  try {
    return decodeURIComponent(linked).toLowerCase() === target;
  } catch {
    return false;
  }
}

function count(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) ? number : null;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function entity(whole: string, name: string): string {
  const code = /^#x/i.test(name)
    ? parseInt(name.slice(2), 16)
    : name.startsWith('#')
      ? Number(name.slice(1))
      : NaN;
  if (Number.isNaN(code)) return ENTITIES[name.toLowerCase()] ?? whole;
  return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
    ? String.fromCodePoint(code)
    : '';
}

/**
 * 正文是带少量 <a> 的纯文本。只取文字：去标签、解实体。结果只当文本渲染，从不当 HTML 插进页面，
 * 所以不经 DOM 解析。用户写的换行原样留下，每行一段。
 */
function paragraphsOf(html: string): readonly string[] {
  const text = html
    .replace(MORE_TAIL, '')
    .replace(LICENSE_TAIL, '')
    .replace(MORE_TAIL, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>|<\/?(?:p|div|li|h[1-6]|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, entity);
  const paragraphs: string[] = [];
  let length = 0;
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/\s+/g, ' ').trim();
    if (!clean || /[\p{Cc}]/u.test(clean)) continue;
    length += clean.length + 1;
    if (length > BIOGRAPHY_TEXT_LIMIT) break;
    paragraphs.push(clean);
  }
  return paragraphs;
}

/**
 * 把 `artist.getInfo` 的应答转成正文与附加资料。回来的艺人链接对不上请求的这位时答 null：
 * 请求时关了 autocorrect，对不上说明应答不可信。没有正文（这种语言没写）时 document 为 null。
 */
export function readLastfmArtistInfo(
  data: unknown,
  artist: string,
  language: BiographyLanguage,
): LastfmArtistInfo | null {
  const info = record(data) ? data['artist'] : undefined;
  if (!record(info) || !linksTo(info['url'], artist)) return null;
  const self = artist.toLowerCase();
  const bio = info['bio'];
  const content = record(bio) && typeof bio['content'] === 'string' ? bio['content'] : '';
  const paragraphs = paragraphsOf(content);
  const tags: string[] = [];
  for (const tag of items(info['tags'], 'tag')) {
    const name = record(tag) ? tag['name'] : undefined;
    // 标签里常有艺人自己的名字，它不是分类。
    if (!biographyField(name, 80) || name.toLowerCase() === self) continue;
    if (!tags.some((item) => item.toLowerCase() === name.toLowerCase())) tags.push(name);
  }
  const stats = record(info['stats']) ? info['stats'] : {};
  const counters: BiographyCounter[] = [];
  const listeners = count(stats['listeners']);
  const plays = count(stats['playcount']);
  if (listeners !== null)
    counters.push({ kind: 'listeners', label: 'Listeners', value: listeners });
  if (plays !== null) counters.push({ kind: 'plays', label: 'Scrobbles', value: plays });
  const similar: BiographyRelatedArtist[] = [];
  for (const item of items(info['similar'], 'artist')) {
    if (!record(item) || typeof item['name'] !== 'string' || typeof item['url'] !== 'string')
      continue;
    const name = biographyArtist(item['name']);
    if (!name || name.toLowerCase() === self || !linksTo(item['url'], name)) continue;
    if (!similar.some((entry) => entry.artist === name))
      similar.push({ artist: name, url: lastfmArtistUrl(name, language) });
  }
  return {
    document: paragraphs.length
      ? {
          artist,
          language,
          paragraphs,
          links: matchBiographyLinks(
            paragraphs,
            [...content.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)].map(
              (match) => ({
                label: paragraphsOf(match[3] ?? '').join(' '),
                url: (match[2] ?? '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, entity),
              }),
            ),
            lastfmArtistUrl(artist, language),
          ),
          url: lastfmBiographyUrl(artist, language),
          licenseUrl: LICENSE.url,
          license: LICENSE.name,
        }
      : null,
    details: { tags: tags.slice(0, 8), counters, similar: similar.slice(0, 6) },
  };
}
