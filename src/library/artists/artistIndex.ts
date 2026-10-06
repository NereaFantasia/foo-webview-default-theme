import type { ArtistInfo } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import {
  albumKeyOf,
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  type Album,
  type AlbumKey,
  type LibraryEventsFace,
} from '../../host/libraryContract.ts';

/** 署名口径一次最多取多少位。宿主不给总数：返回条数到了这个数就当被截断。 */
export const CREDITED_LIMIT = 200_000;

/** 艺人清单的一行。 */
export interface ArtistRow {
  readonly name: string;
  readonly albumCount: number;
  readonly trackCount: number;
  /** 秒。 */
  readonly duration: number;
  /** 专辑艺术家口径是他名下的专辑；署名口径是他署名过的专辑（含客串）。 */
  readonly albums: readonly AlbumKey[];
}

/**
 * 专辑艺术家口径：按专辑清单里每行的 `albumArtist` 归到人，专辑数按行数，曲目数与时长按行累加。
 * 专辑艺术家为空的那些归到「没写艺术家」（空串）。
 */
export function albumArtistRows(albums: readonly Album[]): readonly ArtistRow[] {
  const rows = new Map<string, { trackCount: number; duration: number; albums: AlbumKey[] }>();
  for (const album of albums) {
    const row = rows.get(album.albumArtist) ?? { trackCount: 0, duration: 0, albums: [] };
    row.trackCount += album.trackCount;
    row.duration += album.duration;
    row.albums.push(albumKeyOf(album));
    rows.set(album.albumArtist, row);
  }
  return [...rows].map(([name, row]) => ({ name, albumCount: row.albums.length, ...row }));
}

/**
 * 署名口径：`getArtists` 每个 artist 值一行。专辑按 (专辑名, 专辑艺术家) 区分，与专辑清单的行对得上；
 * 宿主的 `albumCount` 只数专辑名，同名不同人的会并成一张，所以专辑数按专辑引用数。
 */
export function creditedRows(items: readonly ArtistInfo[]): readonly ArtistRow[] {
  return items.flatMap((item) => {
    if (!item.name) return [];
    const albums = (item.albums ?? []).map((ref) =>
      albumKeyOf({ name: ref.name, albumArtist: ref.artist }),
    );
    return [
      {
        name: item.name,
        albumCount: item.albums ? albums.length : item.albumCount,
        trackCount: item.trackCount,
        duration: item.totalDuration,
        albums,
      },
    ];
  });
}

export interface CreditedArtistsState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  /** 还没取到时为 null；重取期间与失败时旧清单留着。 */
  readonly rows: readonly ArtistRow[] | null;
  readonly truncated: boolean;
}

export interface CreditedArtistsFace extends HostReadyFace, LibraryEventsFace {
  readonly library: Pick<typeof fb.library, 'getArtists'>;
}

const INITIAL: CreditedArtistsState = { status: 'idle', rows: null, truncated: false };

/**
 * 署名口径的艺人清单。带专辑的 `getArtists` 是一遍全库扫描，只在 `needed` 为真（艺人地点开着）时取；
 * 宿主把结果留到库变更。库变更合并一阵再重取，期间留着旧清单；用不着时只记下过时，等用到再取。
 */
export function startCreditedArtists(
  store: ReturnType<typeof createStore>,
  needed: Atom<boolean>,
  host: CreditedArtistsFace = fb,
) {
  const state = atom<CreditedArtistsState>(INITIAL);
  let disposed = false;
  let connected = false;
  let outdated = true;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offLibrary: (() => void) | undefined;
  const waiter = waitForHost(host);
  const update = (change: Partial<CreditedArtistsState>) =>
    store.set(state, { ...store.get(state), ...change });

  async function load(): Promise<void> {
    const mine = ++generation;
    outdated = false;
    update({ status: 'loading' });
    const answer = await settle(() =>
      host.library.getArtists(CREDITED_LIMIT, { includeAlbums: true }),
    );
    if (disposed || mine !== generation) return;
    if (!answer || answer.success === false) return update({ status: 'failed' });
    update({
      status: 'ready',
      rows: creditedRows(answer.items),
      truncated: answer.items.length >= CREDITED_LIMIT,
    });
  }

  function refresh(): void {
    if (connected && outdated && !disposed && store.get(needed)) void load();
  }

  function invalidate(): void {
    outdated = true;
    if (disposed || !store.get(needed)) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, LIBRARY_COALESCE_MS);
  }

  async function connect(): Promise<void> {
    if (!(await waiter.done) || disposed) return;
    connected = true;
    offLibrary = onLibraryChanged(host, invalidate);
    if (store.get(needed)) await load();
  }

  const offNeeded = store.sub(needed, refresh);
  return {
    state: atom((get) => get(state)),
    ready: connect(),
    retry(): Promise<void> {
      if (!connected || disposed) return Promise.resolve();
      clearTimeout(timer);
      return load();
    },
    dispose(): void {
      disposed = true;
      generation += 1;
      waiter.cancel();
      clearTimeout(timer);
      offNeeded();
      offLibrary?.();
    },
  };
}

export type CreditedArtistsService = ReturnType<typeof startCreditedArtists>;
