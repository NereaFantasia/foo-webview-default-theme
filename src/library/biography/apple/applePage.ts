import { BIOGRAPHY_TEXT_LIMIT, type BiographyTextLanguage } from '../biographyModel.ts';
import { appleArtistPageUrl } from './appleCatalog.ts';
import {
  appleImageBase,
  readAppleClipFromPage,
  readAppleLogo,
  readAppleWide,
  type AppleLogo,
  type AppleMotion,
  type AppleWide,
} from './appleMedia.ts';

/** 艺人页整页长度上限，超出按读不出处理；页面实测 350 到 700 KB */
const PAGE_LIMIT = 2_000_000;
const NAME_LIMIT = 200;
const GENRE_LIMIT = 80;
const GENRE_COUNT = 8;
/** 不足这个长度又含 Apple Music 字样的是占位句，不是简介 */
const PLACEHOLDER_LIMIT = 150;

/** 一页艺人页里取到的内容。`paragraphs` 为空表示这一页没有真简介 */
export interface AppleProfile {
  readonly id: string;
  readonly name: string;
  /** 艺人页地址，不含查询串 */
  readonly url: string;
  readonly paragraphs: readonly string[];
  /** 简介实际用的语言，按文字内容判；没有简介时为 null */
  readonly textLanguage: BiographyTextLanguage | null;
  readonly genres: readonly string[];
  /** 艺术照的基础地址 */
  readonly image: string | null;
  readonly logo: AppleLogo | null;
  readonly motion: AppleMotion | null;
  /** 艺人页头部铺满用的宽幅图 */
  readonly wide: AppleWide | null;
}

export type ApplePageResult =
  { readonly kind: 'found'; readonly profile: AppleProfile } | { readonly kind: 'invalid' };

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const HAN = /\p{Script=Han}/u;
const LETTER = /\p{L}/u;

/**
 * 按文字内容判语言，因为默认语言的页面在没有译文时返回原文（米津玄師是日文）。汉字、假名、
 * 谚文合计不到字母的五分之一时按英文；其中谚文占一成以上判韩文，假名占一成以上判日文，其余
 * 判中文。中文简介里夹着几个片假名人名，不会被判成日文
 */
export function appleTextLanguage(text: string): BiographyTextLanguage {
  let kana = 0;
  let hangul = 0;
  let han = 0;
  let letters = 0;
  for (const char of text) {
    if (!LETTER.test(char)) continue;
    letters += 1;
    if (KANA.test(char)) kana += 1;
    else if (HANGUL.test(char)) hangul += 1;
    else if (HAN.test(char)) han += 1;
  }
  const cjk = kana + hangul + han;
  if (cjk * 5 < letters) return 'en';
  if (hangul * 10 >= cjk) return 'ko';
  if (kana * 10 >= cjk) return 'ja';
  return 'zh';
}

/**
 * 英文简介用 `<i>` 标专辑与作品名，界面按纯文本显示，不去掉就会露出标签；只认以字母开头的标签，
 * `<3`、`5 < 6` 这类原样保留。读缓存里旧项时也用它
 */
export function stripAppleMarkup(text: string): string {
  return text.replace(/<\/?[a-z][^<>]*>/gi, '');
}

/** 清理成纯文本：以换行分段，空白（含 NBSP）压成单空格，去除控制字符与空行 */
function cleanParagraphs(raw: string): string[] {
  return stripAppleMarkup(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\p{Cc}/gu, (char) => (char === '\n' ? char : ''))
    .replace(/ {2,}/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, limit: number): string | null {
  return typeof value === 'string' &&
    value.trim() &&
    value.length <= limit &&
    !/[\p{Cc}]/u.test(value)
    ? value.normalize('NFC').trim()
    : null;
}

interface PageScripts {
  readonly linked: readonly unknown[];
  readonly data: unknown;
}

/** 只切出 JSON-LD 与 `serialized-server-data` 两段做 JSON.parse，不建 DOM：整页有几百 KB */
function readScripts(html: string): PageScripts {
  const linked: unknown[] = [];
  let data: unknown = null;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1] ?? '';
    const isLinked = /\btype\s*=\s*["']?application\/ld\+json/i.test(attributes);
    const isData = /\bid\s*=\s*["']?serialized-server-data\b/i.test(attributes);
    if (!isLinked && !isData) continue;
    try {
      const value: unknown = JSON.parse(match[2] ?? '');
      if (isLinked) linked.push(value);
      else data = value;
    } catch {
      continue;
    }
  }
  return { linked, data };
}

/** 页面数据头部项：`data[0].data.sections[0].items[0]`，Apple 网页应用的内部结构，变了就让媒体整块不出 */
function headerItem(data: unknown, id: string): Readonly<Record<string, unknown>> | null {
  const pages = record(data) ? data['data'] : null;
  const page = Array.isArray(pages) ? pages[0] : null;
  const sections = record(page) && record(page['data']) ? page['data']['sections'] : null;
  const section: unknown = Array.isArray(sections) ? sections[0] : null;
  const items = record(section) ? section['items'] : null;
  const item: unknown = Array.isArray(items) ? items[0] : null;
  return record(item) && String(item['id']) === id ? item : null;
}

function dictionaryOf(item: Readonly<Record<string, unknown>>, key: string) {
  const artwork = item[key];
  return record(artwork) && record(artwork['dictionary']) ? artwork['dictionary'] : null;
}

function readMotion(item: Readonly<Record<string, unknown>>): AppleMotion | null {
  const square = readAppleClipFromPage(
    dictionaryOf(item, 'videoArtwork')?.['motionArtistSquare1x1'],
  );
  const wide = readAppleClipFromPage(
    dictionaryOf(item, 'wideVideoArtwork')?.['motionArtistWide16x9'],
  );
  return square || wide ? { ...(square ? { square } : {}), ...(wide ? { wide } : {}) } : null;
}

/**
 * 艺人页头部的宽幅图：页面数据里的 `wideArtwork`（原图常是方形，`cropStyle` 给出让图片服务裁成宽图的
 * 裁切码），没有就取宽幅动态艺术照的静帧（本来就是 16:9，整图不裁）
 */
function readWide(
  item: Readonly<Record<string, unknown>>,
  motion: AppleMotion | null,
): AppleWide | null {
  const artwork = item['wideArtwork'];
  const dictionary = dictionaryOf(item, 'wideArtwork');
  const still = record(artwork)
    ? readAppleWide({
        url: dictionary?.['url'],
        crop: artwork['cropStyle'],
        color: dictionary?.['bgColor'],
      })
    : null;
  return (
    still ??
    (motion?.wide
      ? {
          url: motion.wide.poster,
          crop: 'bb',
          ...(motion.wide.color ? { color: motion.wide.color } : {}),
        }
      : null)
  );
}

function readGenres(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      list.flatMap((item: unknown) => {
        const genre = field(item, GENRE_LIMIT);
        return genre ? [genre] : [];
      }),
    ),
  ].slice(0, GENRE_COUNT);
}

/**
 * 读艺人页。`id` 是请求的艺人 ID，页面里的 JSON-LD 指向别的艺人（被跳转到别处）就当读不出
 * 简介、曲风与艺术照取自 JSON-LD，艺术字图片与动态艺术照取自页面数据，后者读不出不影响前者
 */
export function readApplePage(html: string, id: string): ApplePageResult {
  if (html.length > PAGE_LIMIT) return { kind: 'invalid' };
  const scripts = readScripts(html);
  for (const entry of scripts.linked) {
    if (!record(entry)) continue;
    const url = appleArtistPageUrl(entry['url'], id);
    const name = field(entry['name'], NAME_LIMIT);
    if (!url || !name) continue;
    const description = typeof entry['description'] === 'string' ? entry['description'] : '';
    const paragraphs = cleanParagraphs(description);
    const text = paragraphs.join('\n');
    if (text.length > BIOGRAPHY_TEXT_LIMIT) return { kind: 'invalid' };
    const real = text.length >= PLACEHOLDER_LIMIT || !/Apple Music/i.test(text);
    const item = headerItem(scripts.data, id);
    const motion = item ? readMotion(item) : null;
    return {
      kind: 'found',
      profile: {
        id,
        name,
        url,
        paragraphs: real ? paragraphs : [],
        textLanguage: real && text ? appleTextLanguage(text) : null,
        genres: readGenres(entry['genre']),
        image: appleImageBase(entry['image']),
        logo: item ? readAppleLogo(dictionaryOf(item, 'artistLogo')) : null,
        motion,
        wide: item ? readWide(item, motion) : null,
      },
    };
  }
  return { kind: 'invalid' };
}
