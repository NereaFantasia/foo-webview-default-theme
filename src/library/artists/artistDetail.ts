import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import type { AlbumsState } from '../albums.ts';
import { fetchAlbumTracks, type AlbumTracksFace } from '../albumTracks.ts';
import { albumKeyOf, albumYearOf, trackPathOf, type Album } from '../../host/libraryContract.ts';
import type { ArtistRow, CreditedArtistsState } from './artistIndex.ts';

/** 右半一张专辑：「专辑」节里是整张，「参与」节里只留他署名的那几首。 */
export interface ArtistAlbumGroup {
  readonly album: Album;
  readonly tracks: readonly LibraryTrack[];
}

export interface ArtistSummary {
  readonly ownAlbums: number;
  readonly guestAlbums: number;
  readonly tracks: number;
  /** 秒。 */
  readonly duration: number;
  /** 年份跨度，取专辑年份的最早与最晚；都没有年份时为空串。 */
  readonly firstYear: string;
  readonly lastYear: string;
}

export interface Collaborator {
  readonly name: string;
  /** 一起署名的曲目数。 */
  readonly tracks: number;
}

export interface PlayedTrack {
  readonly track: LibraryTrack;
  readonly plays: number;
}

export type ArtistPlays =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'ready'; readonly top: readonly PlayedTrack[] }
  /** 播放次数取不到：多半没装 foo_playcount。不当作「都没听过」。 */
  | { readonly status: 'unavailable' };

export interface ArtistDetail {
  readonly subject: string;
  readonly own: readonly ArtistAlbumGroup[];
  readonly guest: readonly ArtistAlbumGroup[];
  readonly summary: ArtistSummary;
  readonly collaborators: readonly Collaborator[];
}

export interface ArtistDetailState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly subject: string | null;
  readonly detail: ArtistDetail | null;
  /** 有几张专辑的曲目没取到：表照出，缺的那几张不在里面。 */
  readonly partial: boolean;
  readonly refreshFailed: boolean;
  readonly stamp: number;
  /** 署名清单还没取到（或取不到）：「参与」节空着，界面按署名清单的状态写原因。 */
  readonly guestPending: boolean;
  readonly plays: ArtistPlays;
}

/** 焦点停这么久才取右半：在列表里按方向键连续经过的艺人不取。 */
export const DETAIL_DEBOUNCE_MS = 300;
/** 同时在途的取曲目请求数。 */
const CONCURRENCY = 3;
/** 一次求值的曲目数。 */
const PLAY_BATCH = 500;
export const TOP_PLAYED = 10;
/** 常合作最多列几位。 */
export const COLLABORATOR_LIMIT = 12;

const IDLE: ArtistDetailState = {
  status: 'idle',
  subject: null,
  detail: null,
  partial: false,
  refreshFailed: false,
  stamp: 0,
  guestPending: false,
  plays: { status: 'idle' },
};

function byYearThenName(a: Album, b: Album): number {
  const year = (albumYearOf(a) || '9999').localeCompare(albumYearOf(b) || '9999');
  return year || a.name.localeCompare(b.name);
}

/**
 * 两节各有哪些专辑。「专辑」节是专辑艺术家等于他的行；「参与」节是他署名过、专辑艺术家却不是他的
 * 其余专辑。两节都按年份从早到晚，没有年份的排在后面。
 */
export function artistSections(
  subject: string,
  albums: readonly Album[],
  credited: ArtistRow | undefined,
): { readonly own: readonly Album[]; readonly guest: readonly Album[] } {
  const own = albums.filter((album) => album.albumArtist === subject);
  const keys = new Set(credited?.albums ?? []);
  const guest = albums.filter(
    (album) => album.albumArtist !== subject && keys.has(albumKeyOf(album)),
  );
  return { own: [...own].sort(byYearThenName), guest: [...guest].sort(byYearThenName) };
}

/** 统计与常合作。常合作从这些曲目的 artist 多值计数，不拆 feat. 这类字符串。 */
export function summarizeArtist(
  subject: string,
  own: readonly ArtistAlbumGroup[],
  guest: readonly ArtistAlbumGroup[],
): Pick<ArtistDetail, 'summary' | 'collaborators'> {
  const groups = [...own, ...guest];
  const tracks = groups.flatMap((group) => group.tracks);
  const years = groups
    .map((group) => albumYearOf(group.album))
    .filter(Boolean)
    .sort();
  const counts = new Map<string, number>();
  for (const track of tracks)
    for (const name of new Set(track.artists))
      if (name && name !== subject) counts.set(name, (counts.get(name) ?? 0) + 1);
  return {
    summary: {
      ownAlbums: own.length,
      guestAlbums: guest.length,
      tracks: tracks.length,
      duration: tracks.reduce((sum, track) => sum + track.duration, 0),
      firstYear: years[0] ?? '',
      lastYear: years.at(-1) ?? '',
    },
    collaborators: [...counts]
      .map(([name, count]) => ({ name, tracks: count }))
      .sort((a, b) => b.tracks - a.tracks || a.name.localeCompare(b.name))
      .slice(0, COLLABORATOR_LIMIT),
  };
}

export interface ArtistDetailFace extends AlbumTracksFace {
  readonly titleformat: Pick<typeof fb.titleformat, 'evalBatch'>;
}

export interface ArtistDetailDeps {
  readonly stamp?: () => number;
  readonly subject: Atom<string | null>;
  readonly albums: Atom<AlbumsState>;
  readonly credited: Atom<CreditedArtistsState>;
  /** 艺人地点正在显示；隐藏时不启动读取。 */
  readonly active: Atom<boolean>;
}

/**
 * 读一批曲目的播放次数，取次数大于 0 的前 `TOP_PLAYED` 首。全都读不出次数时答 unavailable：
 * 没装 foo_playcount 时 `%play_count%` 不存在，`$if2` 答空串。
 */
export async function readTopPlayed(
  host: Pick<ArtistDetailFace, 'titleformat'>,
  tracks: readonly LibraryTrack[],
  alive: () => boolean = () => true,
): Promise<ArtistPlays | null> {
  const played: PlayedTrack[] = [];
  let known = false;
  for (let start = 0; start < tracks.length; start += PLAY_BATCH) {
    const batch = tracks.slice(start, start + PLAY_BATCH);
    const answer = await settle(() =>
      host.titleformat.evalBatch('$if2(%play_count%,)', batch.map(trackPathOf)),
    );
    if (!alive()) return null;
    if (!answer || answer.success === false) return { status: 'unavailable' };
    answer.results.forEach((row, at) => {
      const track = batch[at];
      if (!track || !row.success || !row.result) return;
      known = true;
      const plays = Number.parseInt(row.result, 10);
      if (plays > 0) played.push({ track, plays });
    });
  }
  if (!known) return { status: 'unavailable' };
  played.sort((a, b) => b.plays - a.plays || a.track.title.localeCompare(b.track.title));
  return { status: 'ready', top: played.slice(0, TOP_PLAYED) };
}

/**
 * 右半的取数：选中一位后停 `DETAIL_DEBOUNCE_MS` 再取，逐张取曲目（宿主缓存归组）、限并发；
 * 换人时立刻撤掉上一位的表，晚到的应答丢掉；同一位重取失败时留着旧表。曲目齐了再读播放次数。
 */
export function startArtistDetail(
  store: ReturnType<typeof createStore>,
  deps: ArtistDetailDeps,
  host: ArtistDetailFace = fb,
) {
  const state = atom<ArtistDetailState>(IDLE);
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cached = new Map<string, ArtistDetailState>();
  let libraryAlbums = store.get(deps.albums).albums;
  let libraryRows = store.get(deps.credited).rows;

  async function groupsOf(
    albums: readonly Album[],
    subject: string,
    own: boolean,
    alive: () => boolean,
  ) {
    const groups: (ArtistAlbumGroup | null)[] = new Array<ArtistAlbumGroup | null>(
      albums.length,
    ).fill(null);
    let failed = false;
    let next = 0;
    async function worker(): Promise<void> {
      while (next < albums.length && alive()) {
        const at = next++;
        const album = albums[at];
        if (!album) continue;
        try {
          const tracks = await fetchAlbumTracks(host, album, { fresh: !!deps.stamp });
          const mine = own ? tracks : tracks.filter((track) => track.artists.includes(subject));
          groups[at] = { album, tracks: mine };
        } catch {
          failed = true;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, albums.length) }, worker));
    return { groups: groups.filter((group): group is ArtistAlbumGroup => group !== null), failed };
  }

  async function load(mine: number): Promise<void> {
    const subject = store.get(deps.subject);
    const alive = () => !disposed && mine === generation;
    if (subject === null) return;
    const library = store.get(deps.albums);
    const credited = store.get(deps.credited);
    const row = credited.rows?.find((item) => item.name === subject);
    const sections = artistSections(subject, library.albums, row);
    const stamp = deps.stamp?.() ?? 0;
    const previous = store.get(state);
    store.set(state, {
      ...(previous.subject === subject ? previous : { ...IDLE, subject }),
      status: previous.subject === subject && previous.detail ? 'ready' : 'loading',
    });
    const own = await groupsOf(sections.own, subject, true, alive);
    const guest = await groupsOf(sections.guest, subject, false, alive);
    if (!alive()) return;
    const missing = own.failed || guest.failed;
    if (
      missing &&
      !own.groups.length &&
      !guest.groups.length &&
      sections.own.length + sections.guest.length
    ) {
      const kept = store.get(state);
      store.set(state, {
        ...kept,
        status: kept.detail ? 'ready' : 'failed',
        refreshFailed: !!kept.detail,
      });
      return;
    }
    const detail: ArtistDetail = {
      subject,
      own: own.groups,
      guest: guest.groups,
      ...summarizeArtist(subject, own.groups, guest.groups),
    };
    store.set(state, {
      status: 'ready',
      subject,
      detail,
      partial: missing,
      refreshFailed: false,
      stamp,
      guestPending: credited.rows === null,
      plays: { status: 'loading' },
    });
    const tracks = [...own.groups, ...guest.groups].flatMap((group) => group.tracks);
    const plays = await readTopPlayed(host, tracks, alive);
    if (plays && alive()) {
      const next = { ...store.get(state), plays };
      store.set(state, next);
      if (!next.partial && !next.guestPending) {
        cached.delete(subject);
        cached.set(subject, next);
        if (cached.size > 32) {
          const oldest = cached.keys().next().value;
          if (oldest !== undefined) cached.delete(oldest);
        }
      }
    }
  }

  // 上一次排程看到的输入。专辑清单与署名清单换了引用才算库变了，只是状态从读取中变成就绪不算。
  let seen: {
    readonly subject: string | null;
    readonly active: boolean;
    readonly albums: AlbumsState['albums'];
    readonly rows: CreditedArtistsState['rows'];
  } | null = null;

  function schedule(force = false): void {
    if (disposed) return;
    const subject = store.get(deps.subject);
    const active = store.get(deps.active);
    const library = store.get(deps.albums);
    const rows = store.get(deps.credited).rows;
    const same =
      seen?.subject === subject &&
      seen.active === active &&
      seen.albums === library.albums &&
      seen.rows === rows;
    if (same && !force) return;
    seen = { subject, active, albums: library.albums, rows };
    generation += 1;
    clearTimeout(timer);
    if (libraryAlbums !== library.albums || libraryRows !== rows) {
      cached.clear();
      libraryAlbums = library.albums;
      libraryRows = rows;
    }
    const known = subject === null ? undefined : cached.get(subject);
    if (!force && known) {
      store.set(state, known);
      return;
    }
    if (store.get(state).subject !== subject)
      store.set(state, subject === null ? IDLE : { ...IDLE, subject, status: 'loading' });
    if (!active || subject === null || library.status === 'idle') return;
    const mine = generation;
    timer = setTimeout(() => void load(mine), DETAIL_DEBOUNCE_MS);
  }

  const stops = [deps.subject, deps.active, deps.albums, deps.credited].map((source) =>
    store.sub(source, () => schedule()),
  );
  schedule();
  return {
    state: atom((get) => get(state)),
    /** 失败后重试，或用户要求刷新：同一位重取。 */
    refresh(): void {
      schedule(true);
    },
    dispose(): void {
      disposed = true;
      generation += 1;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
      cached.clear();
    },
  };
}

export type ArtistDetailService = ReturnType<typeof startArtistDetail>;
