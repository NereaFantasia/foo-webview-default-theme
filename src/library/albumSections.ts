import { normalizeHostPath } from '../host/hostPath.ts';
import {
  albumArtistOf,
  albumKeyOf,
  albumYearOf,
  type Album,
  type AlbumKey,
} from '../host/libraryContract.ts';

// 专辑清单的过滤、排序与分节：一次取全之后都在客户端做，换分节或排序不打宿主。
// 入参数组一律不改，返回新数组。

/** 分节依据。`album` 是不分节的平铺档；取值与 config 里存的一致，改名要写迁移。 */
export const SECTION_DIMENSIONS = [
  'album',
  'albumArtist',
  'artist',
  'genre',
  'folder',
  'libraryRoot',
] as const;
export type SectionDimension = (typeof SECTION_DIMENSIONS)[number];

/** 排序档。取值与 config 里存的一致。 */
export const ALBUM_SORTS = ['name', 'artist', 'year', 'trackCount'] as const;
export type AlbumSort = (typeof ALBUM_SORTS)[number];

export interface AlbumSection {
  /** 节键就是显示的名字；null 是「未知」节，文案由界面取语言包。 */
  readonly key: string | null;
  readonly albums: readonly Album[];
}

/**
 * 排序与节序共用一把尺：数字感知（Vol. 2 在 Vol. 10 前），不分大小写与重音。区域取运行时缺省，
 * 中文 Windows 下是拼音序，比宿主的字节序更合预期。
 */
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * 按过滤词筛：多词 AND、不分大小写，每个词落在专辑名、专辑艺术家或年份之一即算命中。
 * `hits` 是曲目级命中折成的专辑键，在里面的专辑整张算命中。词为空时全部保留。
 */
export function filterAlbums(
  albums: readonly Album[],
  term: string,
  hits?: ReadonlySet<AlbumKey> | null,
): Album[] {
  const words = term
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return [...albums];
  return albums.filter((album) => {
    if (hits?.has(albumKeyOf(album))) return true;
    const fields = [album.name, albumArtistOf(album), albumYearOf(album)].map((field) =>
      field.toLocaleLowerCase(),
    );
    return words.every((word) => fields.some((field) => field.includes(word)));
  });
}

/** 没有年份的恒排最后，其余新的在前。 */
function compareYearDesc(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return collator.compare(b, a);
}

/** 四档排序；主键相同再按专辑名，专辑名也相同时保持入参顺序。 */
export function sortAlbums(albums: readonly Album[], by: AlbumSort): Album[] {
  const byName = (a: Album, b: Album) => collator.compare(a.name, b.name);
  const primary: Record<AlbumSort, (a: Album, b: Album) => number> = {
    name: byName,
    artist: (a, b) => collator.compare(albumArtistOf(a), albumArtistOf(b)),
    year: (a, b) => compareYearDesc(albumYearOf(a), albumYearOf(b)),
    trackCount: (a, b) => b.trackCount - a.trackCount,
  };
  const compare = primary[by];
  return [...albums].sort((a, b) => compare(a, b) || byName(a, b));
}

/** 显示用的路径：去掉协议前缀与 subsong 后缀、分隔符统一为 `\`，大小写照原样。 */
function shownPathOf(path: string): string {
  return path
    .replace(/\|subsong:\d+$/i, '')
    .replace(/^file(?:-relative)?:\/\//i, '')
    .replace(/\//g, '\\');
}

/** 文件所在的目录，写法同 `shownPathOf`；没有目录部分时是空串。 */
export function parentDirectoryOf(path: string): string {
  const shown = shownPathOf(path);
  const cut = shown.lastIndexOf('\\');
  return cut < 0 ? '' : shown.slice(0, cut);
}

/**
 * 首曲在哪个库根的哪个一级目录下。库根互相包含时取最长的那个，否则 `D:\Music` 会把
 * `D:\Music\Classical` 根下的专辑都算进一级目录「Classical」。文件直接放在根下时不归任何一级目录。
 */
function libraryRootSectionOf(
  path: string,
  roots: readonly string[],
  relativeBase: string | null,
): string | null {
  if (!path) return null;
  const normalized = normalizeHostPath(path, relativeBase);
  let matched = '';
  for (const root of roots) {
    if (root && normalized.startsWith(`${root}\\`) && root.length > matched.length) matched = root;
  }
  if (!matched) return null;
  const segments = normalized.split('\\');
  const depth = matched.split('\\').length;
  if (segments.length - 1 <= depth) return null;
  const lower = segments[depth] ?? '';
  // 归一只改路径头部（去前缀、便携安装拼基准），尾部各段与原路径一一对应，从末尾数同样的段数
  // 取原文，目录名就按用户看到的大小写显示；对不上时退回小写。
  const shown = shownPathOf(path).split('\\');
  const original = shown[shown.length - (segments.length - depth)];
  return original !== undefined && original.toLowerCase() === lower ? original : lower;
}

/** 平铺档与艺术家档之外，一张专辑落进哪一节；null 进「未知」节。 */
function sectionKeyOf(
  album: Album,
  dimension: Exclude<SectionDimension, 'album' | 'artist'>,
  roots: readonly string[],
  relativeBase: string | null,
): string | null {
  switch (dimension) {
    case 'albumArtist':
      return albumArtistOf(album) || null;
    case 'genre':
      return album.genre || null;
    case 'folder':
      return parentDirectoryOf(album.firstTrackPath) || null;
    case 'libraryRoot':
      return libraryRootSectionOf(album.firstTrackPath, roots, relativeBase);
  }
}

/** 分节要的外部数据：库根、便携安装的相对路径基准，以及艺术家档的署名。 */
export interface SectionContext {
  /** `library.getRoots` 各根的绝对路径。 */
  readonly roots: readonly string[];
  readonly relativeBase: string | null;
  /** 一张专辑的署名艺术家；专辑进其中每一位的节，一位都没有的进「未知」。 */
  readonly creditsOf: (album: Album) => readonly string[];
}

/**
 * 按依据切节。节内顺序沿用入参（调用方先排序再分节），节序按节键用同一把尺排，「未知」节恒在最后。
 * 平铺档返回单独一节、键为 null，调用方据分节依据决定不画节头。
 */
export function sectionAlbums(
  albums: readonly Album[],
  dimension: SectionDimension,
  context: SectionContext,
): AlbumSection[] {
  if (dimension === 'album') return [{ key: null, albums: [...albums] }];
  const roots = context.roots.map((root) => normalizeHostPath(root).replace(/\\+$/, ''));
  const buckets = new Map<string, Album[]>();
  const unknown: Album[] = [];
  for (const album of albums) {
    const own =
      dimension === 'artist' ? null : sectionKeyOf(album, dimension, roots, context.relativeBase);
    const keys = dimension === 'artist' ? context.creditsOf(album) : own === null ? [] : [own];
    if (keys.length === 0) unknown.push(album);
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(album);
      else buckets.set(key, [album]);
    }
  }
  const sections: AlbumSection[] = [...buckets.entries()]
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([key, list]) => ({ key, albums: list }));
  if (unknown.length > 0) sections.push({ key: null, albums: unknown });
  return sections;
}
