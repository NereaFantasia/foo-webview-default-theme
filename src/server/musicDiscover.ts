import {
  isHttpUrl,
  isInteger,
  isRecord,
  isText,
  readMusicAlbum,
  readMusicPlaylist,
  readMusicTrack,
  type MusicAlbum,
  type MusicPlaylist,
  type MusicRef,
  type MusicTrack,
} from './musicObjects.ts';

// 平台的公共推荐：不登录也能取，内容对所有访客相同；只有网易云提供

export const MUSIC_DISCOVER_KINDS = [
  'banners',
  'charts',
  'playlists',
  'new-tracks',
  'new-albums',
] as const;
export type MusicDiscoverKind = (typeof MUSIC_DISCOVER_KINDS)[number];

/** 新歌与新碟按地区取：全部、华语、欧美、日本、韩国 */
export const MUSIC_DISCOVER_AREAS = ['all', 'zh', 'ea', 'jp', 'kr'] as const;
export type MusicDiscoverArea = (typeof MUSIC_DISCOVER_AREAS)[number];

export type MusicDiscoverRequest =
  | { readonly kind: 'banners' | 'charts' | 'playlists' }
  | { readonly kind: 'new-tracks' | 'new-albums'; readonly area: MusicDiscoverArea };

/** 每类一次最多回这么多项 */
export const MUSIC_DISCOVER_LIMITS: Readonly<Record<MusicDiscoverKind, number>> = {
  banners: 8,
  charts: 13,
  playlists: 30,
  'new-tracks': 30,
  'new-albums': 30,
};

/** 榜单只带前几名 */
export const MUSIC_CHART_TOP = 3;

/** 各国家与地区的榜单所属的国家或地区；`global` 是不分国家的全球榜 */
export const MUSIC_CHART_REGIONS = [
  'us',
  'uk',
  'jp',
  'fr',
  'ru',
  'kr',
  'th',
  'vn',
  'global',
] as const;
export type MusicChartRegion = (typeof MUSIC_CHART_REGIONS)[number];

export type MusicBannerTarget =
  | { readonly kind: 'track'; readonly track: MusicTrack }
  | { readonly kind: 'album'; readonly album: MusicAlbum };

/** 平台的编辑横幅：图上已排好作品名与艺人 */
export interface MusicBanner {
  /** 平台给的小标题，如「新歌首发」，原样显示 */
  readonly label: string;
  /** 编辑图，1080 × 607 */
  readonly image: string;
  readonly target: MusicBannerTarget;
}

export interface MusicChartEntry {
  readonly track: MusicTrack;
  /** 上一期的名次，从 1 数；新上榜为 null */
  readonly previous: number | null;
  /** 进入这个榜的时刻，Unix 毫秒；上游没给时为 null */
  readonly since: number | null;
}

export interface MusicChart {
  /** `kind` 恒为 `chart` */
  readonly chart: MusicPlaylist;
  /** 官方榜为 null */
  readonly region: MusicChartRegion | null;
  /** 这一期的更新时刻，Unix 毫秒 */
  readonly updatedAt: number | null;
  /** 前几名，按名次排，最多 `MUSIC_CHART_TOP` 项 */
  readonly entries: readonly MusicChartEntry[];
}

export interface MusicDiscoverResults {
  readonly banners: readonly MusicBanner[];
  /** 官方榜在前，各国家与地区的榜在后，顺序由后端定 */
  readonly charts: readonly MusicChart[];
  readonly playlists: readonly MusicPlaylist[];
  readonly 'new-tracks': readonly MusicTrack[];
  readonly 'new-albums': readonly MusicAlbum[];
}

function readBanner(value: unknown): MusicBanner | null {
  if (!isRecord(value) || !isText(value.label, 64) || !isHttpUrl(value.image)) return null;
  const target = value.target;
  if (!isRecord(target)) return null;
  const track = target.kind === 'track' ? readMusicTrack(target.track) : null;
  const album = target.kind === 'album' ? readMusicAlbum(target.album) : null;
  const read: MusicBannerTarget | null = track
    ? { kind: 'track', track }
    : album
      ? { kind: 'album', album }
      : null;
  return read && { label: value.label, image: value.image, target: read };
}

function readEntry(value: unknown): MusicChartEntry | null {
  if (!isRecord(value)) return null;
  const track = readMusicTrack(value.track);
  if (
    !track ||
    !(value.previous === null || isInteger(value.previous, 1)) ||
    !(value.since === null || isInteger(value.since, 1))
  )
    return null;
  return { track, previous: value.previous, since: value.since };
}

function readChart(value: unknown): MusicChart | null {
  if (!isRecord(value) || !Array.isArray(value.entries) || value.entries.length > MUSIC_CHART_TOP)
    return null;
  const chart = readMusicPlaylist(value.chart);
  const region =
    value.region === null ? null : MUSIC_CHART_REGIONS.find((item) => item === value.region);
  if (
    chart?.kind !== 'chart' ||
    region === undefined ||
    !(value.updatedAt === null || isInteger(value.updatedAt, 1))
  )
    return null;
  const entries: MusicChartEntry[] = [];
  for (const raw of value.entries) {
    const entry = readEntry(raw);
    if (!entry) return null;
    entries.push(entry);
  }
  return { chart, region, updatedAt: value.updatedAt, entries };
}

/** 一类的全部条目：每项都要合规，同一对象不出现两次 */
function readList<T>(
  value: unknown,
  read: (item: unknown) => T | null,
  refOf: (item: T) => MusicRef,
  limit: number,
): T[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const items: T[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = read(raw);
    if (!item) return null;
    const ref = refOf(item);
    const key = JSON.stringify([ref.platform, ref.id]);
    if (seen.has(key)) return null;
    seen.add(key);
    items.push(item);
  }
  return items;
}

const bannerRef = (banner: MusicBanner) =>
  banner.target.kind === 'track' ? banner.target.track.ref : banner.target.album.ref;

const READERS: {
  readonly [K in MusicDiscoverKind]: (value: unknown) => MusicDiscoverResults[K] | null;
} = {
  banners: (value) => readList(value, readBanner, bannerRef, MUSIC_DISCOVER_LIMITS.banners),
  charts: (value) =>
    readList(value, readChart, (item) => item.chart.ref, MUSIC_DISCOVER_LIMITS.charts),
  playlists: (value) =>
    readList(value, readMusicPlaylist, (item) => item.ref, MUSIC_DISCOVER_LIMITS.playlists),
  'new-tracks': (value) =>
    readList(value, readMusicTrack, (item) => item.ref, MUSIC_DISCOVER_LIMITS['new-tracks']),
  'new-albums': (value) =>
    readList(value, readMusicAlbum, (item) => item.ref, MUSIC_DISCOVER_LIMITS['new-albums']),
};

export function readMusicDiscover<K extends MusicDiscoverKind>(
  value: unknown,
  kind: K,
): MusicDiscoverResults[K] | null {
  return READERS[kind](value);
}
