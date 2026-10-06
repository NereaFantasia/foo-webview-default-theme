import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { registerConfigPersistence, type ConfigSaveState } from '../host/configPref.ts';
import type { ConfigWriter } from '../host/configWrite.ts';
import { settle } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import type { Translate } from '../i18n/translate.ts';
import type { Place } from '../nav/places.ts';
import { LIBRARY_VIEW_PLAYLIST } from './libraryView.ts';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 播放来源：正在播的这些歌从哪来，播放栏的来源一行显示它，点它去来源的家。换曲不改来源，下一次起播才换。
 *
 * 主题发起的起播由调用方记下（`record`）。不是主题发起的（宿主菜单、托盘、快捷键），按宿主此刻在播的
 * 那张表认：`playback:starting` 与 `playback:trackChanged` 到时问一次 `playlist.getPlaying`，在播的表与
 * 来源对应就不动，对不上说明宿主那边换了表，来源改成那张表。经专用列表 `[Library View]` 起播的来源
 * （专辑、艺人、文件夹、查询）对应这张专用列表，列表来源对应它自己的 GUID。在播的是专用列表、
 * 而来源不是经它起播的（没有记录，或记的是别的列表），写成「媒体库」。宿主答没有在播的表时不改。
 *
 * 「这次起播是主题发起的」不靠猜事件，靠 `record` 的时机：调用方在宿主收下起播命令之后才调它，这时宿主
 * 已经切到主题起播的那张表，之后发出的读都读到对应的表，来源不变。宿主起播时事件常先于起播命令的应答到
 * （stopped、stateChanged、starting、trackChanged 依次来），上一张表自己换曲的事件也可能刚好卡在起播
 * 之前，这些事件触发的读若在 `record` 之前发出，读到的可能还是上一张表，所以 `record` 让在途的读一律作废。
 *
 * 跨重启保留，存宿主 config。启动时先读回存档，读回之后才按宿主此刻在播的表核对：先核对的话，存档里的
 * 专辑会被当成「没有记录」、写成媒体库再落盘。读回途中已经 `record` 过的，以 `record` 为准。存档没读成
 * （宿主答失败或没有应答）时，核对照样改显示，但不落盘，免得把读不到的存档盖掉；`record` 照常落盘，
 * 用户新起的播放本就比存档新。
 *
 * 落盘经公共写入助手，在写锁里按发起顺序执行，最后落盘的是最新的来源。`saveState` 只跟最新一次落盘；
 * 失败时来源照常显示，由 `retry` 重写当前来源。
 */
export interface PlaybackSourceFace extends HostReadyFace {
  on: typeof fb.on;
  config: Pick<typeof fb.config, 'get'>;
  playlist: Pick<typeof fb.playlist, 'getPlaying'>;
}

const SOURCE_KEY = 'defaultTheme.playback.source';

/** 主题能记下的来源种类；读存档时只接收这些种类。 */
export const SOURCE_KINDS = ['album', 'artist', 'playlist', 'songs', 'genre', 'folder'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** 写成 type 而不是 interface：要直接存进 config，interface 没有隐式的索引签名。 */
export type RecordedSource = {
  readonly kind: SourceKind;
  /** 专辑是专辑键，列表是 GUID，歌曲页是查询（整库为 `ALL`），流派是流派页的选择标识。 */
  // 艺人主体保留原名与大小写；空串表示没写艺术家。
  readonly subject: string;
  /**
   * 记下那一刻的名字：专辑名、列表名，歌曲页是条件的说明（没有条件时是空串，界面只写「歌曲」）。之后改名这里不跟。
   */
  readonly name: string;
};

/** 在播的是专用列表，主题却没有记下是从哪里起播的：界面写「媒体库」。 */
export type LibrarySource = { readonly kind: 'library' };

export type PlaybackSource = RecordedSource | LibrarySource;

/** 零散挑出来的曲目（右键菜单里的播放之类）起播时记的来源。 */
export const LIBRARY_SOURCE: LibrarySource = { kind: 'library' };

const SOURCE_LABELS = {
  album: 'player.source.album',
  artist: 'player.source.artist',
  playlist: 'player.source.playlist',
  songs: 'player.source.songs',
  genre: 'player.source.genre',
  folder: 'player.source.folder',
  library: 'player.source.library',
} as const;

/** 来源写给人看的样子，如「专辑 · Modal Soul」；只用记下的名字，不参与主体标识的判断。 */
export function sourceLabel(source: PlaybackSource, t: Translate): string {
  const label = t(SOURCE_LABELS[source.kind]);
  return source.kind !== 'library' && source.name
    ? t('player.source.named', { source: label, name: source.name })
    : label;
}

const START_EVENTS = ['playback:starting', 'playback:trackChanged'] as const;

/** 存档是外部数据，种类不认得、主体无效（仅艺人允许空串）、名字不是字符串，都当没有存。 */
function parseSource(raw: unknown): PlaybackSource | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const kind: unknown = Reflect.get(raw, 'kind');
  if (kind === 'library') return { kind: 'library' };
  const known = SOURCE_KINDS.find((candidate) => candidate === kind);
  const subject: unknown = Reflect.get(raw, 'subject');
  const name: unknown = Reflect.get(raw, 'name');
  if (
    !known ||
    typeof subject !== 'string' ||
    (subject === '' && known !== 'artist') ||
    typeof name !== 'string'
  ) {
    return undefined;
  }
  return { kind: known, subject, name };
}

const sourceAtom = atom<PlaybackSource | null>(null);

/** 当前的来源；还没有任何记录时为 null。 */
export const playbackSourceAtom: Atom<PlaybackSource | null> = atom((get) => get(sourceAtom));

/** 来源的家：各业务的主体原样交回对应地点，未记录具体来源的媒体库去专辑页。 */
export function sourceHome(source: PlaybackSource): Place {
  switch (source.kind) {
    case 'album':
      return { id: 'album', subject: source.subject };
    case 'artist':
      return { id: 'artists', subject: source.subject };
    case 'playlist':
      return { id: 'playlist', subject: source.subject };
    case 'songs':
      return { id: 'songs' };
    case 'genre':
      return { id: 'genres', subject: source.subject };
    case 'folder':
      return { id: 'folders', subject: source.subject };
    case 'library':
      return { id: 'albums' };
  }
}

/** 宿主在播 `playing` 那张表时来源该是什么；与当前的对应就原样交回。 */
function followPlaying(
  current: PlaybackSource | null,
  playing: { readonly guid: string; readonly name: string },
): PlaybackSource {
  if (playing.name === LIBRARY_VIEW_PLAYLIST) {
    return current && current.kind !== 'playlist' ? current : { kind: 'library' };
  }
  if (current?.kind === 'playlist' && current.subject === playing.guid) return current;
  return { kind: 'playlist', subject: playing.guid, name: playing.name };
}

export interface PlaybackSourceService {
  /** 存档读回、订阅与第一次核对都做完时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  /** 最近一次落盘的结果。存档没读成、又没有 record 过时不落盘，保持 idle。 */
  readonly saveState: Atom<ConfigSaveState>;
  /**
   * 主题发起了一次起播：在宿主收下起播命令（`playTrack` 答成功）之后调，起播失败不调。立即生效并落盘；
   * 在这之前发出、还没答的核对作废。
   */
  record(source: PlaybackSource): void;
  /** 最近一次落盘失败时重写当前来源，写成答 true；没有失败可重试时答 false。 */
  retry(): Promise<boolean>;
  dispose(): void;
}

/** 没有传入 `writer` 时每次落盘都按失败处理，不绕过写锁直接写宿主。 */
export function startPlaybackSource(
  store: Store,
  host: PlaybackSourceFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
): PlaybackSourceService {
  store.set(sourceAtom, null);
  const saveState = atom<ConfigSaveState>({ status: 'idle' });
  let disposed = false;
  let connected = false;
  let reads = 0;
  // 这次运行里 record 过：存档不再读回。
  let recorded = false;
  // config 里存着的那份可以覆盖了：读回成功过，或者 record 过。
  let writable = false;
  let restoring: Promise<void> = Promise.resolve();
  let saves = 0;
  const offs: (() => void)[] = [];
  const waiter = waitForHost(host);
  const lifetime = new AbortController();

  async function persist(): Promise<boolean> {
    const value = store.get(sourceAtom);
    if (!connected || !writable || !value) return false;
    const mine = ++saves;
    store.set(saveState, { status: 'pending' });
    const result = writer
      ? await writer.set(SOURCE_KEY, value, lifetime.signal)
      : { success: false as const, reason: 'unavailable' as const };
    if (!disposed && mine === saves)
      store.set(
        saveState,
        result.success
          ? { status: 'saved', generation: result.value }
          : { status: 'failed', reason: result.reason },
      );
    return result.success;
  }

  async function restore(): Promise<void> {
    if (recorded) {
      void persist();
      return;
    }
    const answer = await settle(() => host.config.get(SOURCE_KEY));
    if (disposed || recorded || !answer || answer.success === false) return;
    writable = true;
    const stored = answer.found ? parseSource(answer.value) : undefined;
    if (stored) store.set(sourceAtom, stored);
  }

  async function follow(): Promise<void> {
    await restoring;
    if (disposed) return;
    const mine = ++reads;
    const answer = await settle(() => host.playlist.getPlaying());
    if (disposed || mine !== reads || !answer || answer.success === false) return;
    if (!answer.found || answer.guid === undefined) return;
    const current = store.get(sourceAtom);
    const next = followPlaying(current, { guid: answer.guid, name: answer.name ?? '' });
    if (next === current) return;
    store.set(sourceAtom, next);
    void persist();
  }

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed || !arrived) return;
    connected = true;
    restoring = restore();
    // 先订阅再核对，两者之间宿主换了表也不会漏；核对都排在存档读回之后。
    for (const event of START_EVENTS) offs.push(host.on(event, () => void follow()));
    await follow();
  }

  function retry(): Promise<boolean> {
    if (disposed || store.get(saveState).status !== 'failed') return Promise.resolve(false);
    return persist();
  }

  const unregister = registerConfigPersistence(store, {
    state: atom((get) => new Map([[SOURCE_KEY, get(saveState)]])),
    retry,
  });

  return {
    ready: connect(),
    saveState,
    record(source) {
      const valid = parseSource(source);
      if (disposed || !valid) return;
      reads += 1;
      recorded = true;
      writable = true;
      store.set(sourceAtom, valid);
      void persist();
    },
    retry,
    dispose() {
      disposed = true;
      unregister();
      reads += 1;
      waiter.cancel();
      lifetime.abort();
      for (const off of offs.splice(0)) off();
    },
  };
}

export const playbackSourceKey = serviceKey<PlaybackSourceService>('playbackSource');
