import type { MusicAlbum, MusicAlbumSubType, MusicRef } from '../../server/musicObjects.ts';

/** 上游未提供明确类型时判定为专辑的最小曲目数门槛；小于该阈值判定为单曲或 EP */
export const ALBUM_MIN_TRACKS = 7;

/** 发行分组分类：常规专辑、单曲/EP、精选集 */
export type ReleaseGroup = 'album' | 'single' | 'compilation';

/**
 * 计算专辑所属发行分组
 * 优先使用上游声明的类型；缺失时按曲目数推断，曲目数亦缺失时返回 null
 */
export function releaseGroup(album: MusicAlbum): ReleaseGroup | null {
  switch (album.kind) {
    case 'album':
      return 'album';
    case 'single':
    case 'ep':
      return 'single';
    case 'compilation':
      return 'compilation';
    case null:
      break;
  }
  const tracks = album.trackCount;
  if (tracks === null || tracks < 1) return null;
  return tracks >= ALBUM_MIN_TRACKS ? 'album' : 'single';
}

/** 判断目标艺人是否为该专辑的客串/参与艺人；首位署名存在且非目标艺人时判定为参与 */
export function isFeatured(album: MusicAlbum, artist: MusicRef): boolean {
  const lead = album.artists[0]?.ref;
  return !!lead && !(lead.platform === artist.platform && lead.id === artist.id);
}

export interface ReleaseLayout {
  /** 是否至少有一张专辑成功分组；无法分组时全部平铺于 `albums` 且不展示「单曲与 EP」页签 */
  readonly split: boolean;
  /** 专辑页签主体列表；包含无法识别分类的专辑 */
  readonly albums: readonly MusicAlbum[];
  /** 专辑页签末尾合集列表 */
  readonly compilations: readonly MusicAlbum[];
  /** 专辑页签末尾客串/参与专辑列表 */
  readonly featured: readonly MusicAlbum[];
  readonly singles: readonly MusicAlbum[];
}

/** 将艺人专辑列表按类型划分至对应页签与分组，保持组内原始先后顺序 */
export function layoutReleases(albums: readonly MusicAlbum[], artist: MusicRef): ReleaseLayout {
  const groups = albums.map((album) => [album, releaseGroup(album)] as const);
  const split = groups.some(([, group]) => group !== null);
  if (!split) return { split, albums, compilations: [], featured: [], singles: [] };
  const pick = (test: (album: MusicAlbum, group: ReleaseGroup | null) => boolean) =>
    groups.filter(([album, group]) => test(album, group)).map(([album]) => album);
  const featuredHere = (album: MusicAlbum) => isFeatured(album, artist);
  return {
    split,
    albums: pick((album, group) => group === null || (group === 'album' && !featuredHere(album))),
    compilations: pick((_, group) => group === 'compilation'),
    featured: pick((album, group) => group === 'album' && featuredHere(album)),
    singles: pick((_, group) => group === 'single'),
  };
}

/**
 * 将联网检索补充的专辑合并至已有分组布局
 * 补充专辑能独立分组时合并进对应分类，任一方无法分组时平铺至主体列表
 */
export function mergeReleases(
  base: ReleaseLayout,
  extras: readonly MusicAlbum[],
  artist: MusicRef,
): ReleaseLayout {
  if (extras.length === 0) return base;
  const added = layoutReleases(extras, artist);
  if (!base.split || !added.split) return { ...base, albums: [...base.albums, ...extras] };
  return {
    split: true,
    albums: [...base.albums, ...added.albums],
    compilations: [...base.compilations, ...added.compilations],
    featured: [...base.featured, ...added.featured],
    singles: [...base.singles, ...added.singles],
  };
}

export const VERSION_ORDER: readonly MusicAlbumSubType[] = [
  'studio',
  'live',
  'remix',
  'instrumental',
  'demo',
];

export interface VersionOption {
  readonly value: MusicAlbumSubType;
  readonly count: number;
}

const NONE: ReadonlySet<never> = new Set();

/**
 * 提取专辑列表中的版本类型及对应计数
 * `keep` 中的项目即使计数为 0 仍予以保留，以支持用户取消勾选已选条件
 */
export function versionOptions(
  albums: readonly MusicAlbum[],
  keep: ReadonlySet<MusicAlbumSubType> = NONE,
): VersionOption[] {
  const counts = new Map<MusicAlbumSubType, number>();
  for (const album of albums)
    if (album.subType) counts.set(album.subType, (counts.get(album.subType) ?? 0) + 1);
  return VERSION_ORDER.flatMap((value) => {
    const count = counts.get(value) ?? 0;
    return count > 0 || keep.has(value) ? [{ value, count }] : [];
  });
}

/** 按所选版本类型过滤专辑；未选中任何项时返回原列表 */
export function withVersions(
  albums: readonly MusicAlbum[],
  selected: ReadonlySet<MusicAlbumSubType>,
): readonly MusicAlbum[] {
  if (selected.size === 0) return albums;
  return albums.filter((album) => album.subType !== undefined && selected.has(album.subType));
}

/** 单曲与 EP 页签支持筛选的种类预设顺序 */
export const KIND_ORDER = ['single', 'ep'] as const;
export type ReleaseKind = (typeof KIND_ORDER)[number];

export interface KindOption {
  readonly value: ReleaseKind;
  readonly count: number;
}

/** 统计专辑列表中单曲与 EP 的数量；未明确标注类型的不计入 */
export function kindOptions(
  albums: readonly MusicAlbum[],
  keep: ReadonlySet<ReleaseKind> = NONE,
): KindOption[] {
  return KIND_ORDER.flatMap((value) => {
    const count = albums.filter((album) => album.kind === value).length;
    return count > 0 || keep.has(value) ? [{ value, count }] : [];
  });
}

/** 按所选种类过滤专辑列表；未选择任何项时返回原列表 */
export function withKinds(
  albums: readonly MusicAlbum[],
  selected: ReadonlySet<ReleaseKind>,
): readonly MusicAlbum[] {
  if (selected.size === 0) return albums;
  return albums.filter(
    (album) => (album.kind === 'single' || album.kind === 'ep') && selected.has(album.kind),
  );
}

/** 按标题执行忽略大小写的子串检索 */
export function findReleases(albums: readonly MusicAlbum[], query: string): readonly MusicAlbum[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return albums;
  return albums.filter((album) => album.title.toLocaleLowerCase().includes(needle));
}

export const RELEASE_SORT_FIELDS = ['date', 'name', 'tracks'] as const;
export type ReleaseSortField = (typeof RELEASE_SORT_FIELDS)[number];

export interface ReleaseSort {
  readonly field: ReleaseSortField;
  readonly descending: boolean;
}

/** 默认排序规则：按发行日期降序 */
export const DEFAULT_RELEASE_SORT: ReleaseSort = { field: 'date', descending: true };

/** 获取字段默认排序方向：名称升序，日期与曲目数降序 */
export const naturalRelease = (field: ReleaseSortField): ReleaseSort => ({
  field,
  descending: field !== 'name',
});

export const isDefaultReleaseSort = (sort: ReleaseSort) =>
  sort.field === DEFAULT_RELEASE_SORT.field && sort.descending === DEFAULT_RELEASE_SORT.descending;

/** 执行专辑列表排序；缺失日期或曲目数的值恒排末尾，相等项保持原有相对顺序 */
export function sortReleases(
  albums: readonly MusicAlbum[],
  { field, descending }: ReleaseSort,
  collator: Intl.Collator,
): MusicAlbum[] {
  const sign = descending ? -1 : 1;
  const compare = (left: string | number | null, right: string | number | null): number => {
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    if (typeof left === 'string' && typeof right === 'string')
      return sign * (field === 'name' ? collator.compare(left, right) : left.localeCompare(right));
    return sign * (Number(left) - Number(right));
  };
  const key = (album: MusicAlbum) =>
    field === 'date' ? album.releaseDate : field === 'name' ? album.title : album.trackCount;
  return [...albums].sort((left, right) => compare(key(left), key(right)));
}
