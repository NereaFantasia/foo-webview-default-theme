import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../host/hostCall.ts';
import type { Album } from '../../host/libraryContract.ts';
import {
  MIRROR_ORDER_LIMIT,
  MIRROR_PAGE_LIMIT,
  MIRROR_SORT_COLUMNS,
  type MirrorRow,
  type MirrorSortColumn,
  type MirrorStatus,
} from '../../server/libraryMirrorProtocol.ts';
import { TRACK_SORT } from '../../track/trackSort.ts';
import type { MirrorClient } from './mirrorClient.ts';
import type { LibraryMirrorSync } from './mirrorSync.ts';

/** 镜像落后于宿主时，最多等同步追平多久，毫秒；追不上这一次就走宿主 */
const CATCH_UP_MS = 2000;
/** 整库读取用的排序列：翻页的次序随后按库序重排，取歌曲页的缺省排序列，它的索引多半已经建好 */
const WHOLE_LIBRARY_SORT: MirrorSortColumn = 'artist';

export interface MirrorSourceFace {
  library: Pick<typeof fb.library, 'getChanges'>;
}

export interface MirrorSourceDeps {
  readonly client: Pick<MirrorClient, 'status' | 'page' | 'order' | 'albums'>;
  readonly sync: Pick<LibraryMirrorSync, 'sync'>;
  readonly host?: MirrorSourceFace;
  /**
   * 后端是否连上了。页面启动时各页的第一次读取早于后端连接，给了它就先等一阵（连不上或超时答假，直接走宿主）；
   * 没给就当一直连着，由请求失败来分辨
   */
  readonly connected?: () => Promise<boolean>;
}

/** 按某个排序串升序排好的曲目；`paths` 与 `subsongs` 只在要路径时有内容，三个数组按下标对齐 */
export interface MirrorOrdered {
  readonly handles: string[];
  readonly paths: string[];
  readonly subsongs: number[];
}

/**
 * 页面读媒体库镜像的入口。每次读取前先核对镜像追平了宿主（`getChanges` 无待应用变更、后端的纪元与修订号一致），
 * 读完再核对一次修订号没动；任何一步对不上、后端没连着、镜像没建好或读取出错都答 null，由调用方退回宿主查询
 * 次序一律升序，降序由调用方把结果反过来
 */
export interface LibraryMirrorSource {
  /** 整库每一首，按库序。`stale` 为真时放弃并答 null */
  tracks(stale?: () => boolean): Promise<LibraryTrack[] | null>;
  /** 按 `TRACK_SORT` 里的排序串排好的次序；排序串不在镜像能排的列里（含空串）答 null */
  order(sort: string, paths: boolean): Promise<MirrorOrdered | null>;
  /** 专辑清单，形状同 `library.getAlbums`，`label` 恒为空串 */
  albums(): Promise<Album[] | null>;
}

const COLUMN_BY_SORT = new Map<string, MirrorSortColumn>(
  MIRROR_SORT_COLUMNS.flatMap((column) => {
    const sort = TRACK_SORT[column];
    return sort === undefined ? [] : [[sort, column]];
  }),
);

/** 排序串对应的镜像列；镜像排不了的（含库序的空串）为 undefined */
export function mirrorColumnOf(sort: string): MirrorSortColumn | undefined {
  return COLUMN_BY_SORT.get(sort);
}

function trackOf(row: MirrorRow): LibraryTrack {
  return { ...row, artists: [...row.artists], albumArtists: [...row.albumArtists] };
}

function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    work.then(done, done);
  });
}

class Abandoned extends Error {}

export function createMirrorSource(deps: MirrorSourceDeps): LibraryMirrorSource {
  const { client, sync } = deps;
  const host = deps.host ?? fb;

  /** 镜像此刻追平了宿主就答它的状态；落后时催同步追一次 */
  async function hit(): Promise<MirrorStatus | null> {
    if (deps.connected && !(await deps.connected())) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const status = await client.status().catch(() => null);
      if (!status?.ready || status.epoch === '') return null;
      const answer = await settle(() =>
        host.library.getChanges({ epoch: status.epoch, since: status.revision }),
      );
      if (!answer || answer.success === false) return null;
      const pending = (answer.changed?.length ?? 0) + (answer.removed?.length ?? 0);
      if (!answer.resync && pending === 0 && answer.revision === status.revision) return status;
      if (attempt === 0) await withTimeout(sync.sync(), CATCH_UP_MS);
    }
    return null;
  }

  /** 读取跨多次请求，期间镜像被同步改动就弃用这一次的结果 */
  async function stable<T>(read: () => Promise<T>): Promise<T | null> {
    const before = await hit();
    if (!before) return null;
    try {
      const value = await read();
      const after = await client.status();
      const same =
        after.ready && after.epoch === before.epoch && after.revision === before.revision;
      return same ? value : null;
    } catch {
      return null;
    }
  }

  return {
    tracks(stale = () => false) {
      return stable(async () => {
        const tracks: LibraryTrack[] = [];
        let after: string | null = null;
        do {
          const page = await client.page({
            sort: WHOLE_LIBRARY_SORT,
            descending: false,
            after,
            limit: MIRROR_PAGE_LIMIT,
          });
          if (stale()) throw new Abandoned();
          for (const row of page.rows) tracks.push(trackOf(row));
          after = page.next;
        } while (after !== null);
        // 页面里有按遍历次序决定同值先后的地方，宿主给的是库序
        return tracks.sort((a, b) => a.index - b.index);
      });
    },

    order(sort, paths) {
      const column = mirrorColumnOf(sort);
      if (!column) return Promise.resolve(null);
      return stable(async () => {
        const ordered: MirrorOrdered = { handles: [], paths: [], subsongs: [] };
        let after: string | null = null;
        do {
          const part = await client.order({
            sort: column,
            descending: false,
            after,
            limit: MIRROR_ORDER_LIMIT,
            paths,
          });
          ordered.handles.push(...part.handles);
          ordered.paths.push(...part.paths);
          ordered.subsongs.push(...part.subsongs);
          after = part.next;
        } while (after !== null);
        return ordered;
      });
    },

    albums() {
      return stable(async () => (await client.albums()).map((album) => ({ ...album, label: '' })));
    },
  };
}
