import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { registerConfigPersistence, type ConfigSaveState } from '../host/configPref.ts';
import type { ConfigWriter } from '../host/configWrite.ts';
import { settle } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import type { Translate } from '../i18n/translate.ts';
import type { AlbumKey } from '../host/libraryContract.ts';
import type { ObjectRef } from '../nav/objectRef.ts';
import { isPlainGenre, readOnlineListSubject, type Place } from '../nav/places.ts';
import { LIBRARY_VIEW_PLAYLIST } from './libraryView.ts';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 播放来源记录与同步：标识当前播放曲目的来源（如专辑、艺人、播放列表或媒体库），供播放栏展示并支持点击导航回来源页面
 * 常规切歌不改变来源，仅在重新发起起播时更新
 *
 * 主题主动发起的播放由调用方显式登记（`record`）；外部操作（宿主菜单、托盘、全局快捷键）则按宿主当前播放的列表识别：
 * 接收到 `playback:starting` 与 `playback:trackChanged` 时查询 `playlist.getPlaying`，若当前播放列表与来源一致则保持，
 * 否则切换为该列表。经专用列表 `[Library View]` 起播的来源（专辑、艺人、文件夹、查询）映射至该专用列表；
 * 若当前播放专用列表但缺乏来源记录（或指向其他列表），显示为「媒体库」；宿主回报无播放列表时保持原状
 *
 * 识别主动起播不依赖事件推断，而依赖 `record` 调用时机：在宿主接收起播命令后调用，此时宿主已切换至目标列表，
 * 后续读取均能匹配对应列表。由于宿主事件常早于起播响应到达，且上一列表的切歌事件可能在起播前触发，
 * `record` 会同步作废所有在途读取，避免读到旧列表状态
 *
 * 来源状态跨重启持久化至宿主 config。启动时必须先读取存档，完成后再与当前播放列表比对，
 * 避免未读完前误将存档中的专辑判定为无记录并覆盖落盘；读取过程中已发生 `record` 的以新记录为准
 * 存档读取失败时核对逻辑可更新内存展示但不落盘，保护已有存档不被覆盖；用户主动发起的新播放则正常落盘
 *
 * 持久化通过公共写入助手排队执行，按写入锁串行落盘，确保最终保存最新来源；
 * 写入失败时内存展示不受影响，后续调用 `retry` 可重新尝试提交
 */
export interface PlaybackSourceFace extends HostReadyFace {
  on: typeof fb.on;
  config: Pick<typeof fb.config, 'get'>;
  playlist: Pick<typeof fb.playlist, 'getPlaying'>;
}

const SOURCE_KEY = 'defaultTheme.playback.source';

/** 主题能记下的来源种类；读存档时只接收这些种类 */
export const SOURCE_KINDS = [
  'album',
  'artist',
  'playlist',
  'songs',
  'genre',
  'folder',
  'online',
  'onlineAlbum',
  'onlinePlaylist',
  'onlineArtist',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** 采用 type 定义以便直接存入 config（interface 缺少隐式索引签名） */
export type RecordedSource = {
  readonly kind: SourceKind;
  /**
   * 记录来源主体标识：专辑对应专辑键，列表对应 GUID，歌曲页对应查询（整库为 ALL），
   * 流派对应流派标识，在线搜索对应关键词，在线专辑/歌单/热门曲目对应列表地点主体
   */
  // 艺人主体保留原名与大小写；空字符串表示未设置艺术家
  readonly subject: string;
  /**
   * 记录发起播放时刻的快照名称（专辑名、列表名或歌曲筛选条件说明）；后续源对象改名不联动更新
   */
  readonly name: string;
};

/** 在播的是专用列表，主题却没有记下是从哪里起播的：界面写「媒体库」 */
export type LibrarySource = { readonly kind: 'library' };

export type PlaybackSource = RecordedSource | LibrarySource;

/** 零散挑出来的曲目（右键菜单里的播放之类）起播时记的来源 */
export const LIBRARY_SOURCE: LibrarySource = { kind: 'library' };

const SOURCE_LABELS = {
  album: 'player.source.album',
  artist: 'player.source.artist',
  playlist: 'player.source.playlist',
  songs: 'player.source.songs',
  genre: 'player.source.genre',
  folder: 'player.source.folder',
  online: 'player.source.online',
  onlineAlbum: 'player.source.onlineAlbum',
  onlinePlaylist: 'player.source.onlinePlaylist',
  onlineArtist: 'player.source.onlineArtist',
  library: 'player.source.library',
} as const;

/** 来源写给人看的样子，如「专辑 · Modal Soul」；只用记下的名字，不参与主体标识的判断 */
export function sourceLabel(source: PlaybackSource, t: Translate): string {
  const label = t(SOURCE_LABELS[source.kind]);
  return source.kind !== 'library' && source.name
    ? t('player.source.named', { source: label, name: source.name })
    : label;
}

const START_EVENTS = ['playback:starting', 'playback:trackChanged'] as const;

/** 存档是外部数据，种类不认得、主体无效（仅艺人允许空串）、名字不是字符串，都当没有存 */
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

/** 当前的来源；还没有任何记录时为 null */
export const playbackSourceAtom: Atom<PlaybackSource | null> = atom((get) => get(sourceAtom));

/**
 * 来源对应的对象：去来源时经对象打开服务走，取数据、转圈、提示与激活都在那里。没有对应对象的为 null：
 * 歌曲页、在线搜索、媒体库、文件夹页的目录，主体读不出的（多选或没有流派、损坏的在线列表）；这些去 `sourceHome`
 */
export function refOfSource(source: PlaybackSource): ObjectRef | null {
  switch (source.kind) {
    case 'album':
      return { kind: 'album', key: source.subject as AlbumKey };
    case 'artist':
      return { kind: 'artist', name: source.subject };
    case 'playlist':
      return { kind: 'playlist', guid: source.subject };
    case 'genre':
      return isPlainGenre(source.subject) ? { kind: 'genre', value: source.subject } : null;
    case 'onlineAlbum':
    case 'onlinePlaylist':
    case 'onlineArtist': {
      const list = readOnlineListSubject(source.subject);
      return list ? { kind: 'onlineList', list } : null;
    }
    case 'songs':
    case 'folder':
    case 'online':
    case 'library':
      return null;
  }
}

/**
 * 来源的家：各业务的主体原样交回对应地点，未记录具体来源的媒体库去专辑页。在线搜索回到那个查询词的
 * 搜索结果页；要落在在线音乐范围，由调用方另行告诉搜索结果页
 */
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
    case 'online':
      return { id: 'search', subject: source.subject };
    case 'onlineAlbum':
    case 'onlinePlaylist':
    case 'onlineArtist':
      return { id: 'onlineList', subject: source.subject };
    case 'library':
      return { id: 'albums' };
  }
}

/** 宿主在播 `playing` 那张表时来源该是什么；与当前的对应就原样交回 */
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
  /** 存档读回、订阅与第一次核对都做完时兑现，不会拒绝 */
  readonly ready: Promise<void>;
  /** 最近一次落盘的结果。存档没读成、又没有 record 过时不落盘，保持 idle */
  readonly saveState: Atom<ConfigSaveState>;
  /**
   * 主题发起了一次起播：在宿主收下起播命令（`playTrack` 答成功）之后调，起播失败不调。立即生效并落盘；
   * 在这之前发出、还没答的核对作废
   */
  record(source: PlaybackSource): void;
  /** 最近一次落盘失败时重写当前来源，写成答 true；没有失败可重试时答 false */
  retry(): Promise<boolean>;
  dispose(): void;
}

/** 没有传入 `writer` 时每次落盘都按失败处理，不绕过写锁直接写宿主 */
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
  // 这次运行里 record 过：存档不再读回
  let recorded = false;
  // config 里存着的那份可以覆盖了：读回成功过，或者 record 过
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
    // 先订阅再核对，两者之间宿主换了表也不会漏；核对都排在存档读回之后
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
