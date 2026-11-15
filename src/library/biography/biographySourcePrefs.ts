import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import {
  defineConfigPref,
  startConfigPrefs,
  type ConfigPrefFace,
  type ConfigPrefs,
} from '../../host/configPref.ts';
import type { ConfigWriter } from '../../host/configWrite.ts';
import { settle } from '../../host/hostCall.ts';
import { appleArtistId, appleArtistPageUrl } from './apple/appleCatalog.ts';
import type { AppleManualIdentity } from './apple/appleIdentityRecord.ts';
import { biographyArtist, type BiographySource } from './biographyModel.ts';
import { biographyField } from './details/biographyDetailsModel.ts';

/**
 * 简介数据源配置与 Apple 手动指定身份的存储键名
 */
export const BIOGRAPHY_SOURCE_KEY = 'defaultTheme.online.biographySource';
/** 支持的简介数据源列表，首项为默认源 */
export const BIOGRAPHY_SOURCES: readonly BiographySource[] = ['apple', 'lastfm'];
/** 手动指定身份的条目数量上限 */
const IDENTITY_LIMIT = 2000;

type StoredIdentity =
  | { artist: string; sourceId: string; sourceArtist: string; url: string }
  | { artist: string; declined: true };
type StoredPref = {
  version: 1;
  source: BiographySource;
  identities: StoredIdentity[];
  /** Apple 缺失简介时回退拉取 Last.fm 正文的开关（默认关闭） */
  lastfmFallback: boolean;
  /** 被用户手动排除、不再回退拉取 Last.fm 正文的艺人列表 */
  lastfmDeclined: string[];
};

const FALLBACK: StoredPref = {
  version: 1,
  source: 'apple',
  identities: [],
  lastfmFallback: false,
  lastfmDeclined: [],
};

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIdentity(item: unknown): StoredIdentity[] {
  if (!record(item)) return [];
  const artist = typeof item['artist'] === 'string' ? biographyArtist(item['artist']) : null;
  if (!artist) return [];
  if (item['declined'] === true) return [{ artist, declined: true }];
  const sourceId = appleArtistId(item['sourceId']);
  const url = sourceId ? appleArtistPageUrl(item['url'], sourceId) : null;
  const name = item['sourceArtist'];
  return sourceId && url && biographyField(name, 200)
    ? [{ artist, sourceId, sourceArtist: name, url }]
    : [];
}

/**
 * 解析并校验简介数据源偏好对象：
 * 版本不匹配时返回 undefined；数据源未知时回退至默认源；手动指定身份逐项校验，相同艺人以最新记录为准
 */
export function readBiographySourcePref(raw: unknown): StoredPref | undefined {
  if (!record(raw) || raw['version'] !== 1) return undefined;
  const identities = new Map<string, StoredIdentity>();
  if (Array.isArray(raw['identities']))
    for (const item of raw['identities'].slice(0, IDENTITY_LIMIT))
      for (const identity of readIdentity(item)) identities.set(identity.artist, identity);
  const declined = Array.isArray(raw['lastfmDeclined'])
    ? raw['lastfmDeclined'].slice(0, IDENTITY_LIMIT).flatMap((item: unknown) => {
        const artist = typeof item === 'string' ? biographyArtist(item) : null;
        return artist ? [artist] : [];
      })
    : [];
  return {
    version: 1,
    source: BIOGRAPHY_SOURCES.find((source) => source === raw['source']) ?? FALLBACK.source,
    identities: [...identities.values()],
    lastfmFallback: raw['lastfmFallback'] === true,
    lastfmDeclined: [...new Set(declined)],
  };
}

const PREF = defineConfigPref(BIOGRAPHY_SOURCE_KEY, FALLBACK, readBiographySourcePref);

function stored(identity: AppleManualIdentity): StoredIdentity {
  if (identity.declined) return { artist: identity.artist, declined: true };
  const { artist, sourceId, sourceArtist, url } = identity;
  return { artist, sourceId, sourceArtist, url };
}

function manualOf(identity: StoredIdentity): AppleManualIdentity {
  return 'declined' in identity ? identity : { ...identity, declined: false };
}

export interface BiographySourcePrefsService {
  /** 持久化状态与重试句柄，供设置页展示保存反馈 */
  readonly persistence: ConfigPrefs;
  readonly ready: Promise<void>;
  /**
   * 宿主配置就绪标记：
   * 首次从宿主成功读回配置前 `source` 仅为默认值，装配层需等待本标记为 true 再触发拉取，避免误发初始源请求；宿主不可达超时后自动置为 true 并按默认源运行
   */
  readonly loaded: Atom<boolean>;
  readonly source: Atom<BiographySource>;
  readonly identities: Atom<readonly AppleManualIdentity[]>;
  /** 更新数据源选择并持久化，成功返回 true */
  setSource(source: BiographySource): Promise<boolean>;
  /** 保存手动指定身份或排除标记；相同艺人覆盖先前配置 */
  confirm(identity: AppleManualIdentity): Promise<boolean>;
  /** 移除指定艺人的手动设置，恢复自动认定逻辑 */
  forget(artist: string): Promise<boolean>;
  /** Apple 缺失简介时是否回退拉取 Last.fm 正文 */
  readonly lastfmFallback: Atom<boolean>;
  /** 已排除 Last.fm 正文回退的艺人列表 */
  readonly lastfmDeclined: Atom<readonly string[]>;
  setLastfmFallback(on: boolean): Promise<boolean>;
  /** 将指定艺人加入 Last.fm 正文排除列表 */
  declineLastfm(artist: string): Promise<boolean>;
  dispose(): void;
}

/** 在线简介的开关偏好，用于判断来源未保存的用户在升级前是否已开启在线简介 */
export interface LegacyBiographyPrefs {
  readonly ready: Promise<void>;
  readonly enabled: Atom<boolean>;
}

/**
 * 配置写入通过统一写入助手执行；未提供 `writer` 时保存直接返回失败，防止绕过写入锁机制。
 * 给出 `legacy` 时，来源未保存的用户若已开启在线简介则沿用 Last.fm，否则使用缺省来源
 */
export function startBiographySourcePrefs(
  store: ReturnType<typeof createStore>,
  host: ConfigPrefFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
  legacy?: LegacyBiographyPrefs,
): BiographySourcePrefsService {
  const prefs = startConfigPrefs(store, [PREF], host, writer);
  const loaded = atom(false);
  let disposed = false;
  // 来源偏好在本次运行中写入后，迁移不再改写它
  let written = false;
  let stopWatching = () => {};
  const current = () => store.get(PREF.atom);
  const write = (change: Partial<StoredPref>) => {
    written = true;
    return prefs.set(PREF, { ...current(), ...change });
  };
  /**
   * 0.3.0 及更早的版本只有 Last.fm 一个来源，开启在线简介即同意向 Last.fm 发送艺人名，
   * 因此升级前已开启的用户保留 Last.fm。
   * 使用缺省来源的用户首次开启在线简介时保存当前来源，否则下次启动时本服务会把该用户认定为升级前已开启
   */
  async function adopt(): Promise<void> {
    if (!legacy) return;
    await Promise.all([prefs.ready, legacy.ready]);
    if (disposed || written) return;
    const answer = await settle(() => host.config.get(BIOGRAPHY_SOURCE_KEY));
    if (disposed || written || !answer || answer.success === false || answer.found) return;
    if (store.get(legacy.enabled)) {
      void write({ source: 'lastfm' });
      return;
    }
    const { enabled } = legacy;
    stopWatching = store.sub(enabled, () => {
      if (!store.get(enabled)) return;
      stopWatching();
      if (!written) void write({});
    });
  }
  // 读回并确定来源后才将 loaded 置为 true。在此之前来源只是缺省值，
  // 提前放行拉取会让升级前已开启在线简介的用户向 Apple 发送请求
  const ready = Promise.all([prefs.ready, adopt().catch(() => undefined)]).then(() => {
    if (!disposed) store.set(loaded, true);
  });
  return {
    persistence: prefs,
    ready,
    loaded,
    source: atom((get) => get(PREF.atom).source),
    identities: atom((get) => get(PREF.atom).identities.map(manualOf)),
    setSource: (source) => write({ source }),
    confirm: (identity) =>
      write({
        identities: [
          ...current().identities.filter((item) => item.artist !== identity.artist),
          stored(identity),
        ],
      }),
    forget: (artist) =>
      current().identities.some((item) => item.artist === artist)
        ? write({ identities: current().identities.filter((item) => item.artist !== artist) })
        : Promise.resolve(true),
    lastfmFallback: atom((get) => get(PREF.atom).lastfmFallback),
    lastfmDeclined: atom((get) => get(PREF.atom).lastfmDeclined),
    setLastfmFallback: (lastfmFallback) => write({ lastfmFallback }),
    declineLastfm: (artist) =>
      current().lastfmDeclined.includes(artist)
        ? Promise.resolve(true)
        : write({ lastfmDeclined: [...current().lastfmDeclined, artist] }),
    dispose: () => {
      disposed = true;
      stopWatching();
      prefs.dispose();
    },
  };
}
