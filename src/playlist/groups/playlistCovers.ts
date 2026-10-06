import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { artworkRequestSize } from '../../host/artworkSize.ts';
import { settle } from '../../host/hostCall.ts';
import type { HostReadyFace } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';
import type { GroupRun } from './groupLayout.ts';
import type { PlaylistGroupsService } from './playlistGroups.ts';
import type { PlaylistRowsService } from '../playlistRows.ts';

/** 超过多封面上限就退回第一个目录的一张，免得每张图缩得认不出。 */
const MAX_COVERS = 4;
/** 采样点上限：采到这么多还全是不同目录，已经超过上限、退回一张，再采也没用。 */
const MAX_SAMPLES = MAX_COVERS + 1;
/** 同时留着几张列表的封面：来回切换的几张不必重取，别的列表丢掉。 */
const MAX_LISTS = 4;
/** 能带刷新记号的地址：宿主的资源地址与网络地址。 */
const REFRESHABLE = /^(?:fb2k|artwork|https?):/i;

export interface GroupCover {
  /** 喂给 `<img>` 的地址，按目录首次出现的顺序；空数组表示这一组没有封面。 */
  readonly urls: readonly string[];
  readonly status: 'ready' | 'missing';
}

export interface PlaylistCoversFace extends Pick<HostReadyFace, 'isAvailable'> {
  playlist: Pick<typeof fb.playlist, 'getTracks'>;
  artwork: Pick<typeof fb.artwork, 'getFb2kUrlByPath'>;
}

export interface PlaylistCoversDeps {
  readonly rows: Pick<PlaylistRowsService, 'rowAt' | 'currentAt'>;
  readonly groups: Pick<PlaylistGroupsService, 'stateOf'>;
  /** 设备像素比，缺省读 `window.devicePixelRatio`。 */
  readonly pixelRatio?: () => number;
}

export interface PlaylistCoversService {
  /** 封面有了变化就加一；画组头的组件读它，随之重新问 `coverOf`。 */
  readonly versionAtom: Atom<number>;
  /**
   * 这张列表第 `runIndex` 组此刻的封面；还没取到时排一次并答 undefined，这一帧画占位。在渲染时调，只读
   * 缓存、排队，不同步改状态。`displayWidth` 是封面列的 CSS 像素宽，0 表示封面列关着、一张都不取。
   */
  coverOf(guid: string, runIndex: number, displayWidth: number): GroupCover | undefined;
  /** 重取这张列表的封面：看得见的组重新问地址，浏览器不再用它缓存的旧图。 */
  refresh(guid: string): void;
  dispose(): void;
}

/** 目录判据只比到目录一层；Windows 路径不分大小写，折一次再比。 */
function directoryOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return (cut < 0 ? path : path.slice(0, cut)).toLowerCase();
}

/**
 * 采样点：多碟时取每个子组的首行，否则取组首行，末尾再加全组末行。一张专辑拆成 `DISC 1/`、`DISC 2/`
 * 两个文件夹的，这样采得到第二个目录。
 */
function samplePoints(run: GroupRun): number[] {
  const subs = run.sub ?? [];
  const points = subs.length >= 2 ? subs.map((sub) => sub.start) : [run.start];
  const last = run.start + run.count - 1;
  if (!points.includes(last)) points.push(last);
  return points.slice(0, MAX_SAMPLES);
}

interface ListCovers {
  /** 这份缓存按哪一份游程、哪一档尺寸取的；换了就整份清掉。 */
  readonly runs: readonly GroupRun[];
  readonly size: number;
  readonly covers: Map<string, GroupCover>;
  readonly pending: Set<string>;
}

function browserPixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
}

/**
 * 播放列表分组的封面：按组键缓存，按组内采样到的目录决定画几张。只对画出来的组取，请求量由屏幕而不是
 * 列表长度封顶。
 *
 * 多封面的判据是曲目所在目录，不另外探测封面：同目录一张，跨目录每个目录一张。逐首判要对每首开文件查
 * 内嵌图，代价与收益不成比例；目录判据会把「同目录但每首内嵌图不同」合成一张，按专辑分组时少见。
 * 地址由 `artwork.getFb2kUrlByPath` 拼出，拿到地址不代表有图，真正的「没有封面」由 `<img>` 出错判定。
 * 游程换了（组的身份可能已经不同）或请求尺寸跨了档，这张列表的缓存整份清掉。
 */
export function startPlaylistCovers(
  store: Store,
  deps: PlaylistCoversDeps,
  host: PlaylistCoversFace = fb,
): PlaylistCoversService {
  const pixelRatio = deps.pixelRatio ?? browserPixelRatio;
  const version = atom(0);
  const lists = new Map<string, ListCovers>();
  let refreshedAt = 0;
  let disposed = false;
  const bump = () => store.set(version, store.get(version) + 1);

  /** F5 之后的地址带上刷新记号，浏览器不再用缓存的旧图。内联的 `data:` 地址带不了参数，也不必带。 */
  function withRefresh(url: string): string {
    if (!refreshedAt || !REFRESHABLE.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}_refresh=${refreshedAt}`;
  }

  function coversOf(guid: string, runs: readonly GroupRun[], size: number): ListCovers {
    const known = lists.get(guid);
    if (known && known.runs === runs && known.size === size) return known;
    const fresh: ListCovers = { runs, size, covers: new Map(), pending: new Set() };
    lists.delete(guid);
    lists.set(guid, fresh);
    for (const oldest of lists.keys()) {
      if (lists.size <= MAX_LISTS) break;
      lists.delete(oldest);
    }
    return fresh;
  }

  async function pathAt(guid: string, row: number): Promise<string> {
    // 行增删重排之后留着显示的旧页，行号已经对不上：拿它的路径会给新的组取到别的专辑的封面。
    const cached = deps.rows.currentAt(guid, row) ? deps.rows.rowAt(guid, row) : undefined;
    if (cached) return cached.path;
    const page = await settle(() => host.playlist.getTracks(guid, row, 1, undefined, ['path']));
    return page && page.success !== false ? (page.tracks[0]?.path ?? '') : '';
  }

  /** 游程在重取：列表刚增删重排过，手上这份游程的起止可能已经对不上宿主那边的行。 */
  const resyncing = (guid: string) => store.get(deps.groups.stateOf(guid)).loading;

  async function load(guid: string, list: ListCovers, key: string, run: GroupRun): Promise<void> {
    const dropped = () => disposed || lists.get(guid) !== list;
    // 取到一半列表变了：按旧游程的行号读到的可能是新内容里别的专辑，这一次作废，等新游程到了再取。
    const stale = () => {
      if (dropped()) return true;
      if (!resyncing(guid)) return false;
      list.pending.delete(key);
      return true;
    };
    const paths = await Promise.all(samplePoints(run).map((row) => pathAt(guid, row)));
    if (stale()) return;
    // 每个目录留第一条路径当代表；超过上限就退回一张，取第一个目录。
    const byDirectory = new Map<string, string>();
    for (const path of paths) {
      if (path && !byDirectory.has(directoryOf(path))) byDirectory.set(directoryOf(path), path);
    }
    const chosen = [...byDirectory.values()];
    const representatives = chosen.length > MAX_COVERS ? chosen.slice(0, 1) : chosen;
    const answers = await Promise.all(
      representatives.map((path) =>
        settle(() => host.artwork.getFb2kUrlByPath(path, 'front', { maxSize: list.size })),
      ),
    );
    if (stale()) return;
    const urls = answers.flatMap((answer) =>
      answer && answer.success !== false && answer.available && answer.dataUrl
        ? [withRefresh(answer.dataUrl)]
        : [],
    );
    list.pending.delete(key);
    list.covers.set(key, { urls, status: urls.length > 0 ? 'ready' : 'missing' });
    bump();
  }

  return {
    versionAtom: atom((get) => get(version)),
    coverOf(guid, runIndex, displayWidth) {
      if (disposed || displayWidth <= 0 || !host.isAvailable()) return undefined;
      const { runs, loading } = store.get(deps.groups.stateOf(guid));
      const run = runs[runIndex];
      // 游程在重取时不排新的：按旧游程取，拿到的可能是别的专辑的封面。
      if (!run || loading) return undefined;
      const list = coversOf(guid, runs, artworkRequestSize(displayWidth, pixelRatio()));
      const known = list.covers.get(run.key);
      if (known || list.pending.has(run.key)) return known;
      list.pending.add(run.key);
      queueMicrotask(() => {
        if (!disposed && lists.get(guid) === list) void load(guid, list, run.key, run);
      });
      return undefined;
    },
    refresh(guid) {
      if (disposed) return;
      refreshedAt = Math.max(Date.now(), refreshedAt + 1);
      // 首批还没取回时也要通知：画着的组头据此重新问一遍，新地址才带上刷新的记号。
      lists.delete(guid);
      bump();
    },
    dispose() {
      disposed = true;
      lists.clear();
    },
  };
}
