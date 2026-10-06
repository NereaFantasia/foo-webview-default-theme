import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import type { HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import type { PlaylistPlaces } from './playlistPlaces.ts';
import type { PlaylistRowsService } from './playlistRows.ts';
import { playlistsAtom } from '../playback/playlists.ts';

/** 去列表、等行到了再滚过去，最长等这么久，毫秒；过了算没定位成。 */
export const LOCATE_TIMEOUT_MS = 5000;

/** 要页面滚过去、聚焦的那一行。页面照做（或做不到）之后调 `done`。 */
export interface LocateRequest {
  readonly guid: string;
  readonly row: number;
  /** 每发一次加一；页面按它认是不是同一次请求。 */
  readonly tick: number;
}

export interface PlaylistLocateFace extends HostReadyFace {
  player: Pick<typeof fb.player, 'getCurrentTrackIndex'>;
}

export interface PlaylistLocateDeps {
  readonly places: Pick<PlaylistPlaces, 'open'>;
  readonly rows: Pick<PlaylistRowsService, 'stateOf'>;
  /** 正在播放那一首的键，停止时为空串；途中换了曲就作罢。 */
  readonly playingKey: Atom<string>;
}

export interface PlaylistLocateService {
  readonly requestAtom: Atom<LocateRequest | null>;
  /** 读不到位置、列表认不回来或等超时了。 */
  readonly failedAtom: Atom<boolean>;
  /** 去正在播放的那张列表，定位到在播的那一行。没在播、或在播的不在任何列表里时什么也不做。 */
  locate(): Promise<void>;
  /** 页面已经滚到、聚焦那一行，或确认做不到：收起这次请求。 */
  done(tick: number): void;
  dismissFailure(): void;
  dispose(): void;
}

/**
 * 定位正在播放：问宿主在播的是哪张列表的第几行，按此刻的清单换回 GUID，经 `playlistPlaces` 去那张列表的
 * 页（已经在那一页上就不动历史），再把「这一行」交给页面。页面等行与分组都到了再滚过去、聚焦，被过滤挡住
 * 先清过滤，在折起的组里先展开；不起播，也不改选中之外的东西。
 *
 * 等待期间换了曲、那张列表的行增删重排过（行号已经不是那一首）、或又发起了一次，这次作废；
 * `LOCATE_TIMEOUT_MS` 内页面没交还算失败。
 */
export function startPlaylistLocate(
  store: Store,
  deps: PlaylistLocateDeps,
  host: PlaylistLocateFace = fb,
): PlaylistLocateService {
  const request = atom<LocateRequest | null>(null);
  const failed = atom(false);
  let generation = 0;
  let tick = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offWatch: () => void = () => {};

  function cancel(): void {
    generation += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    offWatch();
    offWatch = () => {};
    store.set(request, null);
  }

  function fail(): void {
    cancel();
    store.set(failed, true);
  }

  /** 等待期间换了曲、或那张列表的内容变了：行号已经不是那一首，作罢。 */
  function watch(guid: string, key: string): void {
    const rowsAtom = deps.rows.stateOf(guid);
    const contentVersion = store.get(rowsAtom).contentVersion;
    const offRows = store.sub(rowsAtom, () => {
      const rows = store.get(rowsAtom);
      if (rows.status === 'gone' || rows.contentVersion > contentVersion) cancel();
    });
    const offPlaying = store.sub(deps.playingKey, () => {
      if (store.get(deps.playingKey) !== key) cancel();
    });
    offWatch = () => {
      offRows();
      offPlaying();
    };
  }

  return {
    requestAtom: atom((get) => get(request)),
    failedAtom: atom((get) => get(failed)),
    async locate() {
      cancel();
      store.set(failed, false);
      const key = store.get(deps.playingKey);
      if (disposed || key === '' || !host.isAvailable()) return;
      const mine = generation;
      const current = () => !disposed && mine === generation && store.get(deps.playingKey) === key;
      const answer = await settle(() => host.player.getCurrentTrackIndex());
      if (!current()) return;
      if (!answer || answer.success === false) {
        fail();
        return;
      }
      if (!answer.found || answer.playlist === null || answer.index === null) return;
      const { playlist, index } = answer;
      const lists = store.get(playlistsAtom);
      // 在播的是宿主自己建的那几张：不在任何列出来的列表里，同没在播一样什么都不做。
      if (lists.hiddenIndices.includes(playlist)) return;
      const guid = lists.items.find((item) => item.index === playlist)?.guid;
      if (guid === undefined) {
        fail();
        return;
      }
      deps.places.open(guid);
      tick += 1;
      store.set(request, { guid, row: index, tick });
      watch(guid, key);
      const pending = tick;
      timer = setTimeout(() => {
        if (store.get(request)?.tick === pending) fail();
      }, LOCATE_TIMEOUT_MS);
    },
    done(done) {
      if (store.get(request)?.tick === done) cancel();
    },
    dismissFailure: () => store.set(failed, false),
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
