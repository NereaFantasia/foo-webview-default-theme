import type { LibraryTrackPartial } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';
import { trackPathOf } from '../host/libraryContract.ts';
import { PLAY_LIMIT, replaceAndPlay, type LibraryViewFace } from '../playback/libraryView.ts';
import { TRACK_LIMIT } from './libraryTracks.ts';

// 歌曲、流派与整库随机的起播和发送：按页面同一份查询与排序向宿主要路径，再整份交给列表。不走「转成自动列表再变
// 回普通列表」：宿主转换后要过几百毫秒才把列表填满，立刻解除时列表还是空的。

export interface QueryFillFace extends LibraryViewFace {
  library: LibraryViewFace['library'] & Pick<typeof fb.library, 'query'>;
  playlist: LibraryViewFace['playlist'] &
    Pick<typeof fb.playlist, 'createAutoplaylist' | 'setActive'>;
}

export interface QueryFill {
  /** fb2k 查询；整个媒体库是 `ALL`。 */
  readonly query: string;
  /** Title Formatting 排序串，只有升序；空串是库序。 */
  readonly sort: string;
  /** 表格按降序显示：整份反过来，第 n 行才对得上。 */
  readonly descending: boolean;
}

/** 从哪一首起播：表格里点中的那一行与它的 handle，或者打乱之后从第一首起。 */
export type QueryPlayStart = { readonly row: number; readonly handle: string } | 'shuffle';

const PLAY_FIELDS = ['handle', 'path', 'subsong'];

/** 按页面的查询与排序要回整份曲目，顺序与表格相同；读不到或有一首缺路径时为 null。 */
async function queryTracks(
  host: QueryFillFace,
  fill: QueryFill,
): Promise<readonly LibraryTrackPartial[] | null> {
  const answer = await settle(() =>
    host.library.query(fill.query, fill.sort, TRACK_LIMIT, PLAY_FIELDS),
  );
  if (!answer || answer.success === false) return null;
  if (answer.tracks.some((track) => !track.path)) return null;
  return fill.descending ? [...answer.tracks].reverse() : answer.tracks;
}

const pathOf = (track: LibraryTrackPartial) =>
  trackPathOf({ path: track.path ?? '', subsong: track.subsong ?? 0 });

/** 超过上限时截取的那一段：点中的那一首放在中间，前后各取一半；靠近两头时整段贴着那一头。 */
function windowAround(total: number, at: number): { readonly from: number; readonly to: number } {
  if (total <= PLAY_LIMIT) return { from: 0, to: total };
  const from = Math.max(0, Math.min(at - Math.floor(PLAY_LIMIT / 2), total - PLAY_LIMIT));
  return { from, to: from + PLAY_LIMIT };
}

/** 打乱之后取前 `PLAY_LIMIT` 首（Fisher–Yates，只换到要用的那一截）。 */
function shuffledSample<T>(items: readonly T[]): T[] {
  const pool = [...items];
  const take = Math.min(PLAY_LIMIT, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
  }
  return pool.slice(0, take);
}

/**
 * 按查询起播：曲目整份换进专用列表，从点中的那一首起播；或打乱之后从第一首起（打乱的是这一份，全局的播放顺序
 * 不动）。超过 `PLAY_LIMIT` 首时只交一段：点中的那一首前后各一半，打乱时随机取这么多首。起播保留手动队列，不切
 * 活动列表。点中的那一首在新的结果里找不到（库刚变过）时不播：播错一首比不播更糟。
 */
export async function playByQuery(
  host: QueryFillFace,
  fill: QueryFill,
  start: QueryPlayStart,
  current: () => boolean = () => true,
): Promise<boolean> {
  if (!current()) return false;
  const tracks = await queryTracks(host, fill);
  if (!tracks?.length || !current()) return false;
  if (start === 'shuffle') {
    return replaceAndPlay(host, shuffledSample(tracks).map(pathOf), 0, current);
  }
  const at =
    tracks[start.row]?.handle === start.handle
      ? start.row
      : tracks.findIndex((track) => track.handle === start.handle);
  if (at < 0) return false;
  const { from, to } = windowAround(tracks.length, at);
  return replaceAndPlay(host, tracks.slice(from, to).map(pathOf), at - from, current, start.handle);
}

/** 新建一张列表，按查询把整份曲目加进去，顺序同表格；不设上限：发送不是起播，截掉会丢曲目。 */
export async function sendQueryToNew(
  host: QueryFillFace,
  name: string,
  fill: QueryFill,
  current: () => boolean = () => true,
): Promise<boolean> {
  if (!current()) return false;
  const tracks = await queryTracks(host, fill);
  if (!tracks?.length || !current()) return false;
  const created = await settle(() => host.playlist.create(name));
  if (!created || created.success === false) return false;
  const paths = tracks.map(pathOf);
  const added = current() && (await settle(() => host.library.addToPlaylist(paths, created.guid)));
  const filled = !!added && added.success !== false && added.added === paths.length;
  const remove = host.playlist.remove;
  if (!current() && remove) await settle(() => remove(created.guid));
  return current() && filled;
}

/**
 * 按查询建一张自动播放列表并切为活动列表。自动列表只能按升序排，`descending` 不管；不锁定排序，用户可以自己重排。
 */
export async function createQueryAutoplaylist(
  host: QueryFillFace,
  name: string,
  fill: Pick<QueryFill, 'query' | 'sort'>,
  current: () => boolean = () => true,
): Promise<boolean> {
  if (!current()) return false;
  const created = await settle(() =>
    host.playlist.createAutoplaylist(name, fill.query, fill.sort, false),
  );
  if (!created || created.success === false) return false;
  if (!current()) {
    const remove = host.playlist.remove;
    if (remove) await settle(() => remove(created.guid));
    return false;
  }
  return (await settle(() => host.playlist.setActive(created.guid)))?.success === true;
}
