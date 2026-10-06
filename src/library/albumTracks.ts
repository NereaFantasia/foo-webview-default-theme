import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { albumKeyOf, trackAlbumKeyOf, type Album, type AlbumKey } from '../host/libraryContract.ts';

export interface AlbumTracksFace {
  library: Pick<typeof fb.library, 'getAlbumTracks'>;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * 按（碟号、曲号、标题）排；没有号的是 0，排在前面。同碟同曲号的（多是没标曲号的）按标题的自然序排，
 * 不按库内顺序。
 */
function byDiscTrackTitle(a: LibraryTrack, b: LibraryTrack): number {
  return (
    a.discNumber - b.discNumber ||
    a.trackNumber - b.trackNumber ||
    collator.compare(a.title, b.title)
  );
}

/**
 * 按专辑建智能列表的查询：专辑名相同，且 album artist 或 artist 之一等于专辑键的第二段。fb2k 查询写不出
 * 宿主折叠专辑的口径（首个 album artist 值，没有时取首个 artist 值），所以列表可能比「播放」放的多：
 * 第二段不空时多出合辑里客串的曲目；第二段为空时只按专辑名，同名的别张专辑整张都会进来（fb2k 查询
 * 写不出「首值为空」）。多张用 OR 连。fb2k 查询串的引号里放不了引号，也没有转义写法，任一张的名字带
 * `"` 就整体建不了，答 null；一张都没有也答 null。
 */
export function albumAutoplaylistQuery(albums: readonly Album[]): string | null {
  const parts: string[] = [];
  for (const album of albums) {
    const artist = album.albumArtist;
    if (!album.name || album.name.includes('"') || artist.includes('"')) return null;
    const byName = `album IS "${album.name}"`;
    parts.push(
      artist ? `${byName} AND ("album artist" IS "${artist}" OR artist IS "${artist}")` : byName,
    );
  }
  if (parts.length <= 1) return parts[0] ?? null;
  return parts.map((part) => `(${part})`).join(' OR ');
}

/** 各宿主上还在路上的取数，按专辑键；落地即删。 */
const inflight = new WeakMap<object, Map<AlbumKey, Promise<readonly LibraryTrack[]>>>();

/**
 * 取一张专辑的曲目，排好序。宿主按专辑行的名字与专辑艺术家逐字节认，答这一行折起来的曲目，按碟号、
 * 曲号、库内顺序排；页面再只留 `trackAlbumKeyOf` 与专辑键相同的曲目，按 `byDiscTrackTitle` 重排。
 * 宿主答失败或调用出错时 reject。
 *
 * 同一张还在路上时，后来的直接等那一个：单击封面、下拉与双击起播常常同时要。只合并同时在路上的，
 * 不缓存结果，库变了下一次照取。几处拿到的是同一个数组，谁都不改它。
 *
 * `fresh` 为真时不等在路上的那一个、另发一个，后来的再合并到这个新的上：库刚变过、或者要按发请求前拿的
 * 评分戳对账时，等一个更早发出的请求会拿到变化之前的曲目。
 */
export function fetchAlbumTracks(
  host: AlbumTracksFace,
  album: Album,
  options: { readonly fresh?: boolean } = {},
): Promise<readonly LibraryTrack[]> {
  const key = albumKeyOf(album);
  let table = inflight.get(host);
  if (!table) {
    table = new Map();
    inflight.set(host, table);
  }
  const running = table.get(key);
  if (running && !options.fresh) return running;
  const own = table;
  const request = host.library
    .getAlbumTracks(album.name, album.albumArtist)
    .then((answer) => {
      if (answer.success === false) throw new Error(answer.error);
      const rows = answer.tracks.filter((track) => trackAlbumKeyOf(track) === key);
      return rows.sort(byDiscTrackTitle);
    })
    .finally(() => {
      if (own.get(key) === request) own.delete(key);
    });
  own.set(key, request);
  return request;
}
