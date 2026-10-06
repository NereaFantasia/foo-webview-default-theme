import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { playKeepingQueue, type QueueCommandsFace } from '../host/queueCommands.ts';
import type { Store } from '../kit/store.ts';

/**
 * 从媒体库起播时把来源曲目放进专用列表，供宿主按列表顺序续播。名字不进语言包：换了界面语言也要找得到同一张。
 */
export const LIBRARY_VIEW_PLAYLIST = '[Library View]';

/**
 * 一次交给专用列表的曲目上限，媒体库各处起播（歌曲、流派、多选专辑、文件夹）共用。宿主没有条数上限，实测
 * 2708 首的路径一次加入约 44 ms、请求约 337 KB，大致随首数线性增长；这个数封住一次请求的体量。
 */
export const PLAY_LIMIT = 10_000;

export interface LibraryViewFace {
  queue: QueueCommandsFace['queue'];
  playlist: Pick<
    typeof fb.playlist,
    'getAll' | 'getTracks' | 'create' | 'clear' | 'playTrack' | 'removeAutoplaylist'
  > &
    Partial<Pick<typeof fb.playlist, 'remove'>>;
  library: Pick<typeof fb.library, 'addToPlaylist'>;
}

export interface LibraryViewEntry {
  readonly index: number;
  /** 按 GUID 寻址：一串操作的途中别的列表增删了，序号会指到别处，GUID 不会。 */
  readonly guid: string;
  /** 此刻有几行，追加时新行从这里起。 */
  readonly trackCount: number;
}

const busyAtom = atom(false);

/**
 * 专用列表上有一串操作还没跑完。期间再来的起播与入队不执行：两串清空与追加交错会把列表搅乱，
 * 第二次追加读到的起点也是旧的。整页共用一份：凡是动专用列表的都从 `exclusive` 过。
 */
export const libraryViewBusyAtom: Atom<boolean> = atom((get) => get(busyAtom));

/** 在专用列表上独占地跑一串操作；正忙时不跑，答 `'busy'`。 */
export async function exclusive(
  store: Store,
  step: () => Promise<boolean>,
): Promise<boolean | 'busy'> {
  if (store.get(busyAtom)) return 'busy';
  store.set(busyAtom, true);
  try {
    return await step();
  } finally {
    store.set(busyAtom, false);
  }
}

/**
 * 找专用列表，没有就建一张；读不到清单或建不成时为 null。每次现读 `getAll`，不用侧边栏那份清单：
 * 列表按序号寻址，用户刚删掉前面一张、事件还没带回新清单的那一刻，旧序号指着的是别的列表，
 * 清空清到用户自己的列表上，代价远大于多读一次。按查询填表（`libraryQueryFill.ts`）半途失败时它会留成自动
 * 列表、被锁着，清空与追加都会被拒：先变回普通列表，变不回来也答 null。
 */
export async function ensureLibraryView(
  host: LibraryViewFace,
  current: () => boolean = () => true,
): Promise<LibraryViewEntry | null> {
  if (!current()) return null;
  const all = await settle(() => host.playlist.getAll());
  if (!current() || !all || all.success === false) return null;
  const found = all.playlists.find((playlist) => playlist.name === LIBRARY_VIEW_PLAYLIST);
  if (found) {
    if (found.isAutoplaylist) {
      const plain = await settle(() => host.playlist.removeAutoplaylist(found.guid));
      if (!plain || plain.success === false || plain.source === 'dui') return null;
    }
    return { index: found.index, guid: found.guid, trackCount: found.trackCount };
  }
  const created = await settle(() => host.playlist.create(LIBRARY_VIEW_PLAYLIST));
  if (!created || created.success === false) return null;
  if (!current()) {
    const remove = host.playlist.remove;
    if (remove) await settle(() => remove(created.guid));
    return null;
  }
  return { index: created.index, guid: created.guid, trackCount: 0 };
}

/**
 * 把曲目整份换进专用列表，从第 `index` 首起播。四步串行：找表、清空、加入、起播，任一步失败即停，
 * 不半途起播：清空之后没加进去，这时起播放的是别的东西。宿主解析不出的路径静默跳过，`added` 少于
 * 路径数时第 n 行已是另一首，同样不起播。给了 `expected` 时起播前再核对那一行的 handle。起播保留手动队列，
 * 不切活动列表。
 */
export async function replaceAndPlay(
  host: LibraryViewFace,
  paths: readonly string[],
  index: number,
  current: () => boolean = () => true,
  expected?: string,
): Promise<boolean> {
  if (index < 0 || index >= paths.length) return false;
  const list = await ensureLibraryView(host, current);
  if (!list || !current()) return false;
  const cleared = await settle(() => host.playlist.clear(list.guid));
  if (!cleared || cleared.success === false || !current()) return false;
  const added = await settle(() => host.library.addToPlaylist([...paths], list.guid));
  if (!added || added.success === false || added.added !== paths.length) return false;
  return playKeepingQueue(host, list.guid, index, expected, current);
}

/**
 * 追加到专用列表末尾（不清空，正在播它时不打断），答落下的行号；`added` 对不上时行号就不可信，
 * 答 null，调用方整个不入队。
 */
export async function appendToLibraryView(
  host: LibraryViewFace,
  paths: readonly string[],
): Promise<{ readonly playlist: number; readonly rows: readonly number[] } | null> {
  if (paths.length === 0) return null;
  const list = await ensureLibraryView(host);
  if (!list) return null;
  const added = await settle(() => host.library.addToPlaylist([...paths], list.index));
  if (!added || added.success === false || added.added !== paths.length) return null;
  return { playlist: list.index, rows: paths.map((_, offset) => list.trackCount + offset) };
}
