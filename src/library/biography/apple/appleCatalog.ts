const NAME_LIMIT = 200;
const TITLE_LIMIT = 300;
const GENRE_LIMIT = 80;

/** iTunes 搜索答回的一位艺人 */
export interface AppleArtistHit {
  /** 艺人 ID，数字串 */
  readonly id: string;
  readonly name: string;
  /** 主曲风，iTunes 没给时为空串 */
  readonly genre: string;
  /** 艺人页地址，不含查询串；iTunes 的地址不合格时退成 `/cn/artist/-/{ID}`，页面会跳到规范地址 */
  readonly url: string;
}

/** 批量 Lookup 答回的一张专辑（含单曲与 EP，标题带 ` - Single`、` - EP` 后缀） */
export interface AppleAlbum {
  readonly title: string;
  readonly year: number | null;
  readonly trackCount: number | null;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function results(body: unknown): readonly Readonly<Record<string, unknown>>[] {
  const list = record(body) ? body['results'] : null;
  return Array.isArray(list) ? list.filter(record) : [];
}

function field(value: unknown, limit: number): string | null {
  return typeof value === 'string' &&
    value.trim() &&
    value.length <= limit &&
    !/[\p{Cc}]/u.test(value)
    ? value.normalize('NFC').trim()
    : null;
}

/** 艺人 ID：正整数的数字串，iTunes 的应答里有时是数字有时是字符串 */
export function appleArtistId(value: unknown): string | null {
  const id = typeof value === 'number' ? String(value) : value;
  return typeof id === 'string' && /^[1-9]\d{0,17}$/.test(id) ? id : null;
}

/** 艺人页的规范地址：music.apple.com 的 https 艺人页，路径里的 ID 要对上，去掉查询串与片段 */
export function appleArtistPageUrl(value: unknown, id: string): string | null {
  if (typeof value !== 'string' || value.length > 600) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'music.apple.com' ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    const match = /^\/[a-z]{2}\/artist\/[^/]+\/(\d+)$/.exec(url.pathname);
    return match?.[1] === id ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

/** 取不到 iTunes 给的地址时的兜底：cn 区的艺人页，名字位置写 `-`，页面会 301 到规范地址 */
export function appleFallbackPageUrl(id: string): string {
  return `https://music.apple.com/cn/artist/-/${id}`;
}

/** 读 iTunes 搜索（`entity=musicArtist`）的应答，按应答次序给出艺人；读不出来的项丢掉 */
export function readAppleSearch(body: unknown): readonly AppleArtistHit[] {
  const hits: AppleArtistHit[] = [];
  const seen = new Set<string>();
  for (const item of results(body)) {
    if (item['wrapperType'] !== 'artist') continue;
    const id = appleArtistId(item['artistId']);
    const name = field(item['artistName'], NAME_LIMIT);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    hits.push({
      id,
      name,
      genre: field(item['primaryGenreName'], GENRE_LIMIT) ?? '',
      url: appleArtistPageUrl(item['artistLinkUrl'], id) ?? appleFallbackPageUrl(id),
    });
  }
  return hits;
}

/** 读批量 Lookup（`entity=album`）的应答，按艺人 ID 分组；没有专辑的艺人不出现在表里 */
export function readAppleAlbums(body: unknown): ReadonlyMap<string, readonly AppleAlbum[]> {
  const groups = new Map<string, AppleAlbum[]>();
  for (const item of results(body)) {
    if (item['wrapperType'] !== 'collection') continue;
    const id = appleArtistId(item['artistId']);
    const title = field(item['collectionName'], TITLE_LIMIT);
    if (!id || !title) continue;
    const year = /^\s*(\d{4})/.exec(
      typeof item['releaseDate'] === 'string' ? item['releaseDate'] : '',
    );
    const count = item['trackCount'];
    const album = {
      title,
      year: year ? Number(year[1]) : null,
      trackCount: typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : null,
    };
    const list = groups.get(id);
    if (list) list.push(album);
    else groups.set(id, [album]);
  }
  return groups;
}
