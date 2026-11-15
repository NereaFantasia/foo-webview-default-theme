import type { Track } from 'foo-webview-sdk';
import { isQueryableValue } from './trackQuery.ts';

// 曲目页分面的「专辑」一栏。宿主把没有 album artist 的曲目按首个艺人归专辑，没标专辑艺人的合辑会被拆成每位艺人
// 一张；这一栏改按所在文件夹归：有 album artist 的曲目按（专辑名，首个 album artist）归，与宿主一致；没有的按
// （专辑名，所在文件夹）归，同一文件夹里的同名专辑是一张，不同文件夹里的同名专辑仍是两张
// 取值是一串编码，各段用控制字符隔开，标签里不会有它。写不进查询的取值（带引号、通配符，或路径不是本地绝对路径）不列

const SEPARATOR = '\u001f';

/** 盘符开头，或 UNC 的 `\\服务器\共享` */
const LOCAL_PATH = /^(?:[a-z]:\\|\\\\)/i;

export type AlbumFacetTrack = Pick<Track, 'album' | 'albumId' | 'albumArtists' | 'absolutePath'>;

interface AlbumRef {
  readonly name: string;
  /** 首个 album artist；没有 album artist 时是空串，改按文件夹归 */
  readonly artist: string;
  /** 没有 album artist 时曲目所在的文件夹；有 album artist 时是空串 */
  readonly folder: string;
}

const usable = (part: string) => isQueryableValue(part) && !part.includes(SEPARATOR);

/** 曲目所在的文件夹，写法同 `$directory_path(%path%)`；不是本地绝对路径、或直接放在盘符根下时没有 */
function folderOf(absolutePath: string): string | null {
  if (!LOCAL_PATH.test(absolutePath)) return null;
  const cut = absolutePath.lastIndexOf('\\');
  return cut > 2 ? absolutePath.slice(0, cut) : null;
}

/** 这首曲目在专辑一栏里的取值；没有专辑名、取值写不进查询、或没有可用的身份时是 null */
export function albumFacetValueOf(track: AlbumFacetTrack): string | null {
  // 带 albumId 的专辑含非法 UTF-8 的标签，显示串回不到原值，查不了
  if (track.albumId !== undefined || !usable(track.album)) return null;
  const artist = track.albumArtists[0] ?? '';
  if (artist !== '') return usable(artist) ? [track.album, artist, ''].join(SEPARATOR) : null;
  const folder = folderOf(track.absolutePath);
  return folder !== null && usable(folder) ? [track.album, '', folder].join(SEPARATOR) : null;
}

function refOf(value: string): AlbumRef | null {
  const [name, artist, folder, ...rest] = value.split(SEPARATOR);
  if (name === undefined || artist === undefined || folder === undefined || rest.length > 0) {
    return null;
  }
  // 艺人与文件夹有且只有一个
  if (!usable(name) || (artist === '') === (folder === '')) return null;
  const other = artist === '' ? folder : artist;
  return usable(other) ? { name, artist, folder } : null;
}

/** 取值写给人看的样子：只有专辑名；勾选条与播放来源的名字用它 */
export function albumFacetName(value: string): string {
  return refOf(value)?.name ?? value;
}

/**
 * 一个取值写成的查询。没有 album artist 的一张按文件夹认：`NOT "album artist" PRESENT` 加上
 * `$directory_path(%path%)` 与文件夹相等。有 album artist 的一张只比 album artist 字段，多个 album artist 时
 * 次要的那几位名下的同名专辑也会进来，与宿主按首值折叠的口径差这一点
 */
function albumFacetQuery(value: string): string {
  const ref = refOf(value);
  if (ref === null) return 'NOT ALL';
  const byName = `album IS "${ref.name}"`;
  return ref.artist !== ''
    ? `${byName} AND "album artist" IS "${ref.artist}"`
    : `${byName} AND NOT "album artist" PRESENT AND "$directory_path(%path%)" IS "${ref.folder}"`;
}

/** 勾选的几张专辑任一匹配：每张一段，多张时各段加括号用 OR 连接。取值无法识别的写成匹配不到任何曲目 */
export function albumFacetsQuery(values: readonly string[]): string {
  const terms = values.map(albumFacetQuery);
  return terms.length > 1 ? terms.map((term) => `(${term})`).join(' OR ') : (terms[0] ?? '');
}

/** 文件夹路径的最后一段 */
function lastSegment(folder: string): string {
  return folder.slice(folder.lastIndexOf('\\') + 1);
}

/** 清单里每个取值的显示名：同名的几张在名字后加上艺人或文件夹名区分，不同名的只写专辑名 */
export function withAlbumLabels<T extends { readonly name: string }>(
  values: readonly T[],
): (T & { readonly label: string })[] {
  const refs = values.map((value) => refOf(value.name));
  const sameName = new Map<string, number>();
  for (const ref of refs) if (ref) sameName.set(ref.name, (sameName.get(ref.name) ?? 0) + 1);
  return values.map((value, at) => {
    const ref = refs[at];
    if (!ref) return { ...value, label: value.name };
    if ((sameName.get(ref.name) ?? 0) < 2) return { ...value, label: ref.name };
    return {
      ...value,
      label: `${ref.name} · ${ref.artist !== '' ? ref.artist : lastSegment(ref.folder)}`,
    };
  });
}
