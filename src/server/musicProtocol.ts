import {
  isHttpUrl,
  isInteger,
  isNullableText,
  isRecord,
  isText,
  MUSIC_PLATFORMS,
  MUSIC_QUALITIES,
  readMusicAlbum,
  readMusicArtist,
  readMusicPlaylist,
  readMusicRef,
  readMusicTrack,
  type MusicAlbum,
  type MusicArtist,
  type MusicPlatform,
  type MusicPlaylist,
  type MusicQuality,
  type MusicRef,
  type MusicTrack,
} from './musicObjects.ts';

export const MUSIC_PROTOCOL = 1;

export const MUSIC_SEARCH_KINDS = ['track', 'album', 'artist', 'playlist'] as const;
export type MusicSearchKind = (typeof MUSIC_SEARCH_KINDS)[number];

export interface MusicSearchItems {
  readonly track: MusicTrack;
  readonly album: MusicAlbum;
  readonly artist: MusicArtist;
  readonly playlist: MusicPlaylist;
}

export interface MusicSearchRequest {
  readonly platform: MusicPlatform;
  readonly kind: MusicSearchKind;
  readonly query: string;
  /** 上一页结果的 `nextCursor`，原样传回；null 表示第一页 */
  readonly cursor: string | null;
}

export interface MusicSearchResult<K extends MusicSearchKind = 'track'> {
  readonly items: readonly MusicSearchItems[K][];
  /** 上游自己的页码或偏移，页面不解读；非 null 只表示仍可请求下一页，不保证下一页有结果 */
  readonly nextCursor: string | null;
  /** 上游没有给出总数时为 null */
  readonly total: number | null;
  readonly discardedCount: number;
}

export const MUSIC_LIST_KINDS = ['album', 'playlist', 'artist'] as const;
export type MusicListKind = (typeof MUSIC_LIST_KINDS)[number];

/** 专辑的曲目、歌单的曲目或艺人的热门曲目。专辑与艺人一次给全，只有歌单会续页 */
export interface MusicListRequest {
  readonly kind: MusicListKind;
  readonly ref: MusicRef;
  /** 上一页结果的 `nextCursor`，原样传回；null 表示第一页 */
  readonly cursor: string | null;
}

/** 一页的曲目数加丢弃数的上限 */
export const MUSIC_LIST_LIMIT = 1000;

/** 曲目按上游顺序分页，字段同搜索结果；每一页都带上列表本身，续页时是取那一页时的状态 */
export interface MusicListResult<
  K extends MusicListKind = MusicListKind,
> extends MusicSearchResult<'track'> {
  readonly owner: MusicSearchItems[K];
}

export const MUSIC_TRACKS_LIMIT = 100;

/** 答复只含取到的曲目，顺序不定；上游已下架或 LX 的记录已淘汰的不在其中 */
export interface MusicTracksRequest {
  readonly platform: MusicPlatform;
  /** 同一平台的曲目 ID，不重复，最多 `MUSIC_TRACKS_LIMIT` 个 */
  readonly ids: readonly string[];
}

export interface MusicResolveRequest {
  readonly ref: MusicRef;
  readonly quality: MusicQuality;
}

export interface MusicResource {
  readonly ref: MusicRef;
  readonly url: string;
  readonly requestedQuality: MusicQuality;
  /** 上游报告的音质；未分析音频内容，不据此承诺编码质量 */
  readonly actualQuality: MusicQuality | null;
  /** Unix 毫秒时间；未获知有效期时为 null，不代表永久有效 */
  readonly expiresAt: number | null;
  /** 平台自己取不到完整版本，由第三方来源补全（网易云的解灰）；这时 `actualQuality` 为 null */
  readonly unblocked: boolean;
  /** 给出这个地址的音源脚本名；只有 lxserver 答了才有，网易云没有 */
  readonly sourceName?: string;
}

const NCM_PHASES = ['missing', 'installed', 'loaded', 'failed'] as const;
const LX_PHASES = ['unconfigured', 'invalid-config', 'catalog-unavailable', 'ready'] as const;

export interface MusicStatus {
  /** 现在提供的平台。网易云组件加载失败时仍列出网易云，下一次请求会重新加载 */
  readonly platforms: readonly MusicPlatform[];
  /** installed 表示组件已下载，第一次用到网易云时才加载 */
  readonly ncm: (typeof NCM_PHASES)[number];
  /** ready 仅表示配置与本地记录可用，尚未探测上游或音源脚本 */
  readonly lx: (typeof LX_PHASES)[number];
  /** 已保存的自建 lxserver 连接，配置文件不存在或无效时为 null。令牌只说有没有设置 */
  readonly lxServer: {
    readonly url: string;
    readonly username: string | null;
    readonly hasToken: boolean;
  } | null;
  /** 走后端托管的 lxserver：没有自建配置、组件已装好。这时 `lxServer` 为 null */
  readonly lxHosted: boolean;
  /** 网易云账号，未登录时为 null。页面只拿到昵称，Cookie 不离开后端；登录时没取到昵称则为 null */
  readonly account: { readonly nickname: string | null } | null;
  /** 是否用第三方来源补全网易云里无法播放的曲目 */
  readonly unblock: boolean;
}

/**
 * 保存 lxserver 连接；`url` 为 null 时删除。`username` 为 null 表示不登录 lxserver
 * 省略 `userToken` 时沿用已保存的令牌，只在服务地址的源不变时可以省略，令牌不会发给另一台服务器
 */
export type MusicLxConfigRequest =
  | { readonly url: null }
  | { readonly url: string; readonly username: string | null; readonly userToken?: string };

/** 测试连接：none 是没设置用户名与令牌，valid 与 invalid 是 lxserver 对令牌的判断 */
export const MUSIC_LX_AUTH = ['none', 'valid', 'invalid'] as const;
export type MusicLxAuth = (typeof MUSIC_LX_AUTH)[number];

export const MUSIC_LOGIN_STATES = ['waiting', 'scanned', 'expired', 'signed-in'] as const;
export type MusicLoginState = (typeof MUSIC_LOGIN_STATES)[number];

/** 网易云扫码登录的二维码 */
export interface MusicLoginCode {
  /** 交回 `/music/login-check` 查询扫码状态；二维码过期后作废 */
  readonly key: string;
  /** PNG 图片的 data URL */
  readonly image: string;
}

export const MUSIC_FAILURE_LIMIT = 50;

/**
 * 音频路由打开占位地址时的一次失败。入队时 fb2k 也会打开地址，有记录不代表这首已被跳过
 * `seq` 严格递增且不小于记录时的毫秒时间，后端重启后接着变大；页面记下最大的一个，下次只问它之后的
 */
export interface MusicStreamFailure {
  readonly seq: number;
  readonly ref: MusicRef;
  readonly code: MusicFailureCode;
  /** Unix 毫秒时间 */
  readonly at: number;
}

/**
 * 音频路由打开占位地址时取到的地址是不是第三方补全的。补全的每次打开都记；不是补全的只在这首上一次记成
 * 补全时记一条，序号与失败共用
 */
export interface MusicStreamSource {
  readonly seq: number;
  readonly ref: MusicRef;
  readonly unblocked: boolean;
  /** Unix 毫秒时间 */
  readonly at: number;
}

export interface MusicStreamFailures {
  /** 最新一条失败或来源记录的序号；后端启动以来都没有时为 0 */
  readonly latest: number;
  /** 序号大于请求里 `after` 的记录，从旧到新；后端只保留最近 `MUSIC_FAILURE_LIMIT` 条 */
  readonly items: readonly MusicStreamFailure[];
  /** 同上，来源记录也只留最近 `MUSIC_FAILURE_LIMIT` 条 */
  readonly sources: readonly MusicStreamSource[];
}

export type MusicFailureCode =
  | 'invalid-request'
  | 'not-configured'
  | 'not-installed'
  | 'invalid-config'
  | 'catalog-unavailable'
  | 'track-missing'
  | 'not-found'
  | 'cancelled'
  | 'timeout'
  | 'authentication'
  | 'upstream-unavailable'
  /** 上游答「操作频繁」一类；冷却期间后端不再替元数据请求问上游 */
  | 'rate-limited'
  | 'invalid-upstream'
  | 'unplayable'
  | 'membership-required'
  | 'unblock-missing'
  | 'settings-unavailable'
  /** 导入的音源脚本不合用：不支持网易云以外的平台、要放开 VM，或 lxserver 不收 */
  | 'source-rejected'
  | 'unsupported';

export type MusicReply<T> =
  | { readonly protocol: typeof MUSIC_PROTOCOL; readonly success: true; readonly data: T }
  | {
      readonly protocol: typeof MUSIC_PROTOCOL;
      readonly success: false;
      readonly error: { readonly code: MusicFailureCode; readonly message: string };
    };

/** 游标原样往返于页面与后端，两边按同一规则核对 */
export function isMusicCursor(value: unknown): value is string {
  return typeof value === 'string' && /^\S{1,256}$/.test(value);
}

const SEARCH_ITEM_READERS: {
  readonly [K in MusicSearchKind]: (value: unknown) => MusicSearchItems[K] | null;
} = {
  track: readMusicTrack,
  album: readMusicAlbum,
  artist: readMusicArtist,
  playlist: readMusicPlaylist,
};

export function readMusicStatus(value: unknown): MusicStatus | null {
  if (!isRecord(value) || !Array.isArray(value.platforms)) return null;
  const offered = value.platforms;
  const platforms = MUSIC_PLATFORMS.filter((item) => offered.includes(item));
  const ncm = NCM_PHASES.find((item) => item === value.ncm);
  const lx = LX_PHASES.find((item) => item === value.lx);
  if (platforms.length !== offered.length || !ncm || !lx) return null;
  // 网易云只由 NCM 提供，其余平台只由 LX 提供
  if (platforms.includes('wy') !== (ncm !== 'missing')) return null;
  if (platforms.some((item) => item !== 'wy') !== (lx === 'ready')) return null;
  const server = value.lxServer;
  let lxServer: MusicStatus['lxServer'] = null;
  if (server !== null) {
    if (!isRecord(server) || !isHttpUrl(server.url) || !isNullableText(server.username))
      return null;
    if (typeof server.hasToken !== 'boolean') return null;
    lxServer = { url: server.url, username: server.username, hasToken: server.hasToken };
  }
  // 自建的配置读得出来或走托管，才有记录可读或已就绪
  const connected = lx === 'ready' || lx === 'catalog-unavailable';
  if (typeof value.lxHosted !== 'boolean' || (value.lxHosted && !connected)) return null;
  if ((lxServer !== null) !== (connected && !value.lxHosted)) return null;
  const account = value.account;
  if (typeof value.unblock !== 'boolean') return null;
  const base = { platforms, ncm, lx, lxServer, lxHosted: value.lxHosted, unblock: value.unblock };
  if (account === null) return { ...base, account };
  if (!isRecord(account) || !isNullableText(account.nickname)) return null;
  return { ...base, account: { nickname: account.nickname } };
}

export function readMusicLxAuth(value: unknown): MusicLxAuth | null {
  return isRecord(value) ? (MUSIC_LX_AUTH.find((item) => item === value.auth) ?? null) : null;
}

export function readMusicLoginCode(value: unknown): MusicLoginCode | null {
  if (
    !isRecord(value) ||
    !isText(value.key, 256) ||
    typeof value.image !== 'string' ||
    !value.image.startsWith('data:image/png;base64,') ||
    value.image.length > 65536
  )
    return null;
  return { key: value.key, image: value.image };
}

export function readMusicLoginState(value: unknown): MusicLoginState | null {
  return isRecord(value) ? (MUSIC_LOGIN_STATES.find((item) => item === value.state) ?? null) : null;
}

export function readPage<T extends { readonly ref: MusicRef }>(
  value: unknown,
  read: (item: unknown) => T | null,
  limit: number,
) {
  if (
    !isRecord(value) ||
    !isInteger(value.discardedCount) ||
    !(value.total === null || isInteger(value.total)) ||
    !(value.nextCursor === null || isMusicCursor(value.nextCursor)) ||
    !Array.isArray(value.items) ||
    value.items.length + value.discardedCount > limit ||
    (value.items.length === 0 && value.discardedCount !== 0)
  )
    return null;
  const items: T[] = [];
  const seen = new Set<string>();
  for (const raw of value.items) {
    const item = read(raw);
    if (!item) return null;
    const key = JSON.stringify([item.ref.platform, item.ref.id]);
    if (seen.has(key)) return null;
    seen.add(key);
    items.push(item);
  }
  return {
    items,
    nextCursor: value.nextCursor,
    total: value.total,
    discardedCount: value.discardedCount,
  };
}

export function readMusicSearchResult<K extends MusicSearchKind>(
  value: unknown,
  kind: K,
): MusicSearchResult<K> | null {
  return readPage(value, SEARCH_ITEM_READERS[kind], 20);
}

export function readMusicListResult<K extends MusicListKind>(
  value: unknown,
  kind: K,
): MusicListResult<K> | null {
  const page = readPage(value, readMusicTrack, MUSIC_LIST_LIMIT);
  const owner = isRecord(value) ? SEARCH_ITEM_READERS[kind](value.owner) : null;
  return page && owner ? { ...page, owner } : null;
}

export function readMusicTracks(value: unknown): MusicTrack[] | null {
  if (!Array.isArray(value) || value.length > MUSIC_TRACKS_LIMIT) return null;
  const items: MusicTrack[] = [];
  for (const item of value) {
    const track = readMusicTrack(item);
    if (!track) return null;
    items.push(track);
  }
  return items;
}

export function readMusicResource(value: unknown): MusicResource | null {
  if (!isRecord(value)) return null;
  const reference = readMusicRef(value.ref);
  const requestedQuality = MUSIC_QUALITIES.find((item) => item === value.requestedQuality);
  const actualQuality =
    value.actualQuality === null
      ? null
      : MUSIC_QUALITIES.find((item) => item === value.actualQuality);
  if (
    !reference ||
    !requestedQuality ||
    actualQuality === undefined ||
    !isHttpUrl(value.url) ||
    !(value.expiresAt === null || isInteger(value.expiresAt)) ||
    typeof value.unblocked !== 'boolean'
  )
    return null;
  return {
    ref: reference,
    url: value.url,
    requestedQuality,
    actualQuality,
    expiresAt: value.expiresAt,
    unblocked: value.unblocked,
    ...(isText(value.sourceName, 512) ? { sourceName: value.sourceName } : {}),
  };
}

const FAILURE_CODES: readonly MusicFailureCode[] = [
  'invalid-request',
  'not-configured',
  'not-installed',
  'invalid-config',
  'catalog-unavailable',
  'track-missing',
  'not-found',
  'cancelled',
  'timeout',
  'authentication',
  'upstream-unavailable',
  'rate-limited',
  'invalid-upstream',
  'unplayable',
  'membership-required',
  'unblock-missing',
  'settings-unavailable',
  'source-rejected',
  'unsupported',
];

export function readMusicStreamFailures(value: unknown): MusicStreamFailures | null {
  if (
    !isRecord(value) ||
    !isInteger(value.latest) ||
    !Array.isArray(value.items) ||
    value.items.length > MUSIC_FAILURE_LIMIT ||
    !Array.isArray(value.sources) ||
    value.sources.length > MUSIC_FAILURE_LIMIT
  )
    return null;
  const latest = value.latest;
  const items: MusicStreamFailure[] = [];
  let previous = 0;
  for (const item of value.items) {
    if (!isRecord(item)) return null;
    const reference = readMusicRef(item.ref);
    const code = FAILURE_CODES.find((candidate) => candidate === item.code);
    if (
      !reference ||
      !code ||
      !isInteger(item.seq, previous + 1) ||
      item.seq > latest ||
      !isInteger(item.at)
    )
      return null;
    previous = item.seq;
    items.push({ seq: item.seq, ref: reference, code, at: item.at });
  }
  const sources: MusicStreamSource[] = [];
  previous = 0;
  for (const item of value.sources) {
    if (!isRecord(item)) return null;
    const reference = readMusicRef(item.ref);
    if (
      !reference ||
      typeof item.unblocked !== 'boolean' ||
      !isInteger(item.seq, previous + 1) ||
      item.seq > latest ||
      !isInteger(item.at)
    )
      return null;
    previous = item.seq;
    sources.push({ seq: item.seq, ref: reference, unblocked: item.unblocked, at: item.at });
  }
  return { latest, items, sources };
}

/** 重建协议对象，额外字段不会进入调用方的状态 */
export function readMusicReply<T>(
  value: unknown,
  read: (data: unknown) => T | null,
): MusicReply<T> | null {
  if (!isRecord(value) || value.protocol !== MUSIC_PROTOCOL) return null;
  if (value.success === false && isRecord(value.error) && isText(value.error.message)) {
    const error = value.error;
    const code = FAILURE_CODES.find((item) => item === error.code);
    return code
      ? { protocol: MUSIC_PROTOCOL, success: false, error: { code, message: value.error.message } }
      : null;
  }
  if (value.success !== true) return null;
  const data = read(value.data);
  return data === null ? null : { protocol: MUSIC_PROTOCOL, success: true, data };
}
