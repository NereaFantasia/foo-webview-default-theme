import type { LibraryTrack } from 'foo-webview-sdk';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import type { MessageKey } from '../../i18n/en.ts';
import { historyAtom, type NavHistoryService } from '../../nav/navHistory.ts';
import type { Store } from '../../kit/store.ts';
import { fetchAlbumTracks, type AlbumTracksFace } from '../albumTracks.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../../host/libraryContract.ts';

/** 进详情页时曲目这么久还没到，被点处出小转圈，毫秒。 */
export const OPEN_SPINNER_DELAY_MS = 300;

/** 从哪儿点进来的：下拉里的 › 键，或者这张专辑本身（封面、专辑名、专辑菜单）。转圈出在被点的那一处。 */
export type AlbumOpenOrigin = 'dropdown' | 'album';

export interface AlbumOpening {
  readonly key: AlbumKey;
  readonly origin: AlbumOpenOrigin;
}

const pendingAtom = atom<AlbumOpening | null>(null);
const noticeAtom = atom<MessageKey | null>(null);

/** 正在为进哪一张的详情页取曲目、而且已经等过了 `OPEN_SPINNER_DELAY_MS`：被点处据此出小转圈。 */
export const albumDetailPendingAtom: Atom<AlbumOpening | null> = atom((get) => get(pendingAtom));
/** 进详情页没进成（取不到、答了空）的提示，由发起的那一页显示。 */
export const albumDetailNoticeAtom: Atom<MessageKey | null> = atom((get) => get(noticeAtom));

export interface AlbumDetailOpenDeps {
  readonly history: Pick<NavHistoryService, 'navigate'>;
  readonly stamp: () => number;
  /** 取到的曲目交给详情页的数据服务，进页之后不必再取。`stamp` 是发请求前拿的评分戳。 */
  readonly seed: (album: Album, tracks: readonly LibraryTrack[], stamp: number) => void;
}

export interface AlbumDetailOpen {
  /**
   * 进这张专辑的详情页：先取曲目，取到了再进。等过 `OPEN_SPINNER_DELAY_MS` 还没到时报
   * `albumDetailPendingAtom`。连点只认最后一次；途中去了别处就作罢。取不到或答了空只挂提示，不进页面。
   */
  open(album: Album, origin?: AlbumOpenOrigin): void;
  dismissNotice(): void;
  dispose(): void;
}

export function startAlbumDetailOpen(
  store: Store,
  deps: AlbumDetailOpenDeps,
  host: AlbumTracksFace,
): AlbumDetailOpen {
  store.set(pendingAtom, null);
  store.set(noticeAtom, null);
  let disposed = false;
  let opening = 0;
  /** 发起时所在的那条历史记录；换了记录就作罢。 */
  let openedFrom: object | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stop(): void {
    clearTimeout(timer);
    openedFrom = null;
    if (store.get(pendingAtom) !== null) store.set(pendingAtom, null);
  }

  // 等着进详情页的途中去了别处（点了侧边栏、后退）：不再把人拉过去。
  const offHistory = store.sub(historyAtom, () => {
    if (openedFrom !== null && store.get(historyAtom).entry !== openedFrom) {
      opening += 1;
      stop();
    }
  });

  return {
    open(album, origin = 'album') {
      if (disposed) return;
      const mine = ++opening;
      const key = albumKeyOf(album);
      stop();
      openedFrom = store.get(historyAtom).entry;
      timer = setTimeout(() => {
        if (opening === mine) store.set(pendingAtom, { key, origin });
      }, OPEN_SPINNER_DELAY_MS);
      // 另发一个请求，不等更早发出的：曲目要与这一刻拿的评分戳对得上。
      const stamp = deps.stamp();
      void settle(() => fetchAlbumTracks(host, album, { fresh: true })).then((tracks) => {
        if (disposed || opening !== mine) return;
        stop();
        if (!tracks || tracks.length === 0) {
          store.set(noticeAtom, tracks ? 'albumDetail.notFound' : 'albumDetail.openFailed');
          return;
        }
        store.set(noticeAtom, null);
        deps.seed(album, tracks, stamp);
        deps.history.navigate({ id: 'album', subject: key });
      });
    },
    dismissNotice() {
      if (!disposed) store.set(noticeAtom, null);
    },
    dispose() {
      disposed = true;
      stop();
      offHistory();
    },
  };
}
