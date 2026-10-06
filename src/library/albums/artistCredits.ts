import type { ArtistInfo } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';
import { ALBUM_LIMIT } from '../albums.ts';
import { browserPrefsAtom } from './browserPrefs.ts';
import {
  albumKeyOf,
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  type AlbumKey,
  type LibraryEventsFace,
} from '../../host/libraryContract.ts';

/** 专辑键到署名过它的艺术家（去重）。只由没标 artist 的曲目组成的专辑不在表里。 */
export type AlbumCredits = ReadonlyMap<AlbumKey, readonly string[]>;

export interface ArtistCreditsState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  /** 还没取到时为 null：艺术家档要等它才分得了节。重取期间与失败时旧表都留着。 */
  readonly credits: AlbumCredits | null;
  /** 艺术家条目数到了上限：后面的艺术家没回来，他们署名的专辑可能落进「未知」节。 */
  readonly truncated: boolean;
}

const INITIAL: ArtistCreditsState = { status: 'idle', credits: null, truncated: false };
const stateAtom = atom<ArtistCreditsState>(INITIAL);

export const artistCreditsAtom: Atom<ArtistCreditsState> = atom((get) => get(stateAtom));

/** 只有分节依据是「艺术家」时才要这张表。 */
const neededAtom = atom((get) => get(browserPrefsAtom).dimension === 'artist');

export interface ArtistCreditsFace extends HostReadyFace, LibraryEventsFace {
  library: Pick<typeof fb.library, 'getArtists'>;
}

export interface ArtistCreditsService {
  /** 连上宿主、订好库变更时兑现；那时已要这张表的，等初读做完。不会拒绝。 */
  readonly ready: Promise<void>;
  /** 失败横幅上的重试。 */
  retry(): Promise<void>;
  dispose(): void;
}

/**
 * 每位署名艺术家一个条目：曲目 artist 标签的每个值各算一位。条目里专辑的 `artist` 与专辑清单同一口径
 * （album artist 首值，缺则 artist 首值），按 `albumKeyOf` 正好对上清单里的一行。
 */
function creditsOf(items: readonly ArtistInfo[]): AlbumCredits {
  const credits = new Map<AlbumKey, Set<string>>();
  for (const item of items) {
    if (!item.name) continue;
    for (const ref of item.albums ?? []) {
      const key = albumKeyOf({ name: ref.name, albumArtist: ref.artist });
      const names = credits.get(key) ?? new Set<string>();
      names.add(item.name);
      credits.set(key, names);
    }
  }
  return new Map([...credits].map(([key, names]) => [key, [...names]]));
}

/**
 * 启动「艺术家」分节的署名表。带专辑的 `getArtists` 是一遍全库扫描，只在分节依据切到「艺术家」时
 * 才取，不预取；宿主把扫描结果留到库变更。库变更与专辑清单同一合并窗：用得着就重取，用不着只记下
 * 过时了，等再切过来再取。
 */
export function startArtistCredits(
  store: Store,
  host: ArtistCreditsFace = fb,
): ArtistCreditsService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let connected = false;
  let outdated = true;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offLibrary: (() => void) | undefined;
  const waiter = waitForHost(host);

  const update = (change: Partial<ArtistCreditsState>) =>
    store.set(stateAtom, { ...store.get(stateAtom), ...change });

  async function load(): Promise<void> {
    const mine = ++generation;
    outdated = false;
    update({ status: 'loading' });
    // limit 只截艺术家条目，不截每位的专辑。
    const answer = await settle(() =>
      host.library.getArtists(ALBUM_LIMIT, { includeAlbums: true }),
    );
    if (disposed || mine !== generation) return;
    if (!answer || answer.success === false) {
      update({ status: 'failed' });
      return;
    }
    update({
      status: 'ready',
      credits: creditsOf(answer.items),
      truncated: answer.items.length >= ALBUM_LIMIT,
    });
  }

  function cancelTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function refresh(): void {
    if (connected && outdated && !disposed && store.get(neededAtom)) void load();
  }

  function invalidate(): void {
    outdated = true;
    if (disposed || !store.get(neededAtom)) return;
    cancelTimer();
    timer = setTimeout(() => {
      timer = undefined;
      refresh();
    }, LIBRARY_COALESCE_MS);
  }

  async function connect(): Promise<void> {
    if (!(await waiter.done) || disposed) return;
    connected = true;
    offLibrary = onLibraryChanged(host, invalidate);
    if (store.get(neededAtom)) await load();
  }

  const offNeeded = store.sub(neededAtom, refresh);

  return {
    ready: connect(),
    retry() {
      if (!connected || disposed) return Promise.resolve();
      cancelTimer();
      return load();
    },
    dispose() {
      disposed = true;
      generation += 1;
      waiter.cancel();
      cancelTimer();
      offNeeded();
      offLibrary?.();
    },
  };
}
