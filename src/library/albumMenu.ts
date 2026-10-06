import type { LibraryTrack, MenuCommand, MenuItem } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import type { HostReadyFace } from '../host/waitForHost.ts';
import { localeAtom } from '../i18n/locale.ts';
import type { MenuNode } from '../host/menuNodes.ts';
import {
  EMPTY_CONTEXT_TREE,
  FAILED_CONTEXT_TREE,
  readContextTree,
  type ContextMenuFace,
  type ContextTree,
} from '../host/contextMenu.ts';
import type { Store } from '../kit/store.ts';
import { albumAutoplaylistQuery, fetchAlbumTracks, type AlbumTracksFace } from './albumTracks.ts';
import { trackPathOf, type Album } from '../host/libraryContract.ts';
import { PLAY_LIMIT } from '../playback/libraryView.ts';
import { readSendTargets, type SendTarget } from '../track/trackListActions.ts';

/**
 * 一批专辑取曲目的上限，只管多选，单张总是去取。首数同起播的上限；张数另封一道：曲目逐张向宿主取，实测每张
 * 约 2 ms（2708 首的库），500 张约 1 秒。
 */
export const UNION_ALBUM_LIMIT = 500;
export const UNION_TRACK_LIMIT = PLAY_LIMIT;
/** 按路径建「更多命令」树的条数上限：宿主逐条校验路径，再多就不建，子菜单置灰。 */
export const MENU_HANDLES_LIMIT = 500;

/** 这一批专辑过没过取曲目的上限。单张不算：打开一张专辑的菜单总要去取。 */
function unionLimited(albums: readonly Album[]): boolean {
  const trackTotal = albums.reduce((sum, album) => sum + album.trackCount, 0);
  return albums.length > 1 && (albums.length > UNION_ALBUM_LIMIT || trackTotal > UNION_TRACK_LIMIT);
}

/** 专辑菜单开在哪：视口坐标，CSS 像素。 */
export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

/** 专辑菜单此刻针对的那一批。右键封面与悬停的「更多」是同一份菜单、同一份状态。 */
export interface AlbumMenuState {
  /** 作用对象，按网格的阅读顺序。 */
  readonly albums: readonly Album[];
  /** 这批专辑的曲目，逐张排好序再首尾相接。 */
  readonly tracks: readonly LibraryTrack[];
  /** 曲目还没取回：播放、入队、发送几项置灰。 */
  readonly loading: boolean;
  /** 张数或首数过了上限，没去取曲目，那几项一直置灰。 */
  readonly limited: boolean;
  /** 取曲目失败，那几项同样置灰。 */
  readonly failed: boolean;
  /** 「发送到」子菜单的目标。 */
  readonly targets: readonly SendTarget[];
  /** 「更多命令」：宿主对这批曲目的上下文命令树；没取到或过了上限是空树。 */
  readonly tree: ContextTree;
  /** 名字里带双引号的专辑建不了智能列表。 */
  readonly canCreateAutoplaylist: boolean;
  /** 下拉曲目菜单的落点在专辑里的序号；作用对象为 `tracks`，专辑菜单为 null。 */
  readonly trackIndex: number | null;
  readonly ratingStamp: number;
}

const EMPTY_MENU: AlbumMenuState = {
  albums: [],
  tracks: [],
  loading: false,
  limited: false,
  failed: false,
  targets: [],
  tree: EMPTY_CONTEXT_TREE,
  canCreateAutoplaylist: false,
  trackIndex: null,
  ratingStamp: 0,
};

const stateAtom = atom<AlbumMenuState>(EMPTY_MENU);

export const albumMenuAtom: Atom<AlbumMenuState> = atom((get) => get(stateAtom));

function commandsOf(items: readonly MenuItem[]): MenuCommand[] {
  return items.flatMap((item) => {
    if (item.type === 'command') return [item];
    return item.type === 'submenu' ? commandsOf(item.children) : [];
  });
}

/** 「更多命令」里的一项能不能执行：右键菜单的命令按生成那棵树时的编号执行，没有编号的执行不了。 */
export function hasCommandId(node: MenuNode): boolean {
  return node.type === 'command' && typeof node.commandId === 'number';
}

/**
 * 点中的节点是这棵树里的哪一条命令；不是命令、或不是这棵树里的（菜单开着时树换过）答 undefined。
 * 按对象认，不按内容：编号只在生成它的那棵树里有意义，别的树里一模一样的节点也不能拿来执行。
 */
export function menuCommandOf(tree: ContextTree, node: MenuNode): MenuCommand | undefined {
  return commandsOf(tree.roots).find((candidate) => candidate === node);
}

/** 菜单那一批能不能跑命令：曲目到手了、没过上限，答它们的路径；否则 null。 */
export function menuPathsOf(state: AlbumMenuState): string[] | null {
  if (state.loading || state.limited || state.tracks.length === 0) return null;
  return state.tracks.map(trackPathOf);
}

export interface AlbumMenuFace
  extends Pick<HostReadyFace, 'isAvailable'>, AlbumTracksFace, ContextMenuFace {
  playlist: Pick<typeof fb.playlist, 'getAll'>;
}

export interface AlbumMenuService {
  /**
   * 菜单打开前调：定下作用对象，再取曲目、「发送到」的目标与「更多命令」树，都到手时兑现。
   * 连着打开两次时，先打开的那一批晚到的结果丢掉。
   */
  prepare(albums: readonly Album[]): Promise<void>;
  /**
   * 下拉里的曲目选择：`index` 是右键落点，曲目按当前曲序给出，读取这批曲目的命令树。
   * 与 `prepare` 共用一份状态，后开的那次作数。
   */
  prepareTracks(
    album: Album,
    tracks: readonly LibraryTrack[],
    index: number,
    ratingStamp?: number,
  ): Promise<void>;
  retry(): Promise<void>;
  close(): void;
  dispose(): void;
}

/** 启动专辑菜单的数据面。命令树要对着这批曲目的路径建，所以等曲目到手再读。 */
export function startAlbumMenu(store: Store, host: AlbumMenuFace = fb): AlbumMenuService {
  store.set(stateAtom, EMPTY_MENU);
  let disposed = false;
  let generation = 0;
  let treeRequest = 0;
  const update = (change: Partial<AlbumMenuState>) =>
    store.set(stateAtom, { ...store.get(stateAtom), ...change });

  async function retry() {
    if (disposed) return;
    const mine = generation;
    const request = ++treeRequest;
    const { tracks, failed } = store.get(stateAtom);
    if (!host.isAvailable() || failed) return update({ tree: FAILED_CONTEXT_TREE });
    if (!tracks.length || tracks.length > MENU_HANDLES_LIMIT)
      return update({ tree: { ...EMPTY_CONTEXT_TREE, loading: false } });
    update({ tree: EMPTY_CONTEXT_TREE });
    const tree = await readContextTree(
      host,
      { mode: 'handles', handles: tracks.map(trackPathOf) },
      store.get(localeAtom).base,
    );
    if (!disposed && mine === generation && request === treeRequest) update({ tree });
  }

  /** 逐张取，取完一张先看这一批过没过期，过期了剩下的不再发：每张都是宿主的一遍全库过滤。 */
  async function collectTracks(
    albums: readonly Album[],
    current: () => boolean,
  ): Promise<LibraryTrack[] | null> {
    const rows: LibraryTrack[] = [];
    for (const album of albums) {
      const tracks = await settle(() => fetchAlbumTracks(host, album));
      if (!tracks || !current()) return null;
      rows.push(...tracks);
    }
    return rows;
  }

  return {
    retry,
    async prepare(albums) {
      const mine = ++generation;
      const current = () => !disposed && mine === generation;
      const limited = unionLimited(albums);
      const usable = !disposed && host.isAvailable();
      const fetching = usable && !limited && albums.length > 0;
      store.set(stateAtom, {
        ...EMPTY_MENU,
        albums: [...albums],
        loading: fetching,
        limited,
        canCreateAutoplaylist: albumAutoplaylistQuery(albums) !== null,
      });
      if (!usable) return update({ failed: true, tree: FAILED_CONTEXT_TREE });
      const targets = readSendTargets(host).then((list) => {
        if (current()) update({ targets: list });
      });
      if (fetching) {
        const tracks = await collectTracks(albums, current);
        if (!current()) return;
        update({ tracks: tracks ?? [], loading: false, failed: !tracks });
        await retry();
      }
      await targets;
    },
    async prepareTracks(album, tracks, index, ratingStamp = 0) {
      const mine = ++generation;
      const current = () => !disposed && mine === generation;
      store.set(stateAtom, {
        ...EMPTY_MENU,
        albums: [album],
        tracks: [...tracks],
        trackIndex: index,
        ratingStamp,
      });
      if (disposed) return;
      if (!host.isAvailable()) return update({ failed: true, tree: FAILED_CONTEXT_TREE });
      const [list] = await Promise.all([readSendTargets(host), retry()]);
      if (current()) update({ targets: list });
    },
    close() {
      generation += 1;
    },
    dispose() {
      disposed = true;
      generation += 1;
    },
  };
}
