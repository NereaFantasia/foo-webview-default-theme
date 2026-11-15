import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import type { LocalAlbum } from './apple/appleMatch.ts';
import { lastfmInputOf } from './biographyInput.ts';
import type {
  BiographyIdentity,
  BiographyInput,
  BiographyLanguage,
  BiographyState,
} from './biographyModel.ts';
import type { BiographyResources } from './biographyResources.ts';
import { startBiography, type BiographyHost, type BiographyService } from './biographyService.ts';
import type { BiographySourcePrefsService } from './biographySourcePrefs.ts';
import { startBiographyIdentity } from './identity/biographyIdentity.ts';

export interface LastfmFallbackDeps {
  /** 艺人身份键名，与主链路对应同一艺人；本地艺人采用艺人名 */
  readonly artist: Atom<string | null>;
  /** 检索使用的艺人名称，缺省取 `artist` */
  readonly term?: Atom<string | null>;
  readonly albums: Atom<readonly LocalAlbum[] | null>;
  readonly active: Atom<boolean>;
  /** 在线功能已开启且数据源偏好已就绪 */
  readonly enabled: Atom<boolean>;
  /** 主链路输入与正文服务，由外部统一创建与释放 */
  readonly input: Atom<BiographyInput | null>;
  readonly apple: BiographyService;
  readonly sourcePrefs: Pick<
    BiographySourcePrefsService,
    'source' | 'lastfmFallback' | 'lastfmDeclined'
  >;
  /** Last.fm 数据源下用户手动指定的艺人身份 */
  readonly manual: Atom<BiographyIdentity | null>;
  /** 简介语言偏好；目标语言缺失时回退拉取英文正文 */
  readonly language: Atom<BiographyLanguage>;
  readonly locale: Atom<string>;
  readonly lastfmKey: Atom<string>;
  readonly resources: BiographyResources;
}

const loading = (state: BiographyState): BiographyState => ({ ...state, status: 'loading' });

/**
 * Apple 简介缺失时回退拉取 Last.fm 正文：
 *
 * 触发条件：当前源为 Apple、回退开关开启、Apple 身份已确认但页面缺失正文，且该艺人未被用户排除；
 * 优先匹配 Last.fm 手动指定身份，缺失时通过 MusicBrainz 自动认定（仅采纳确权结果，不展示候选列表）；
 * 仅补充正文内容，曲风与照片等元数据仍保留 Apple 数据，不拉取 Last.fm 附加资料
 *
 * 对外输出合并后的 `service` 供界面面板读取：
 * 未触发回退时输出 Apple 结果；回退中标记为 loading；获取正文后替换展示；未识别或无正文时回退至 missing 状态；失败时附带 `fallbackProblem`
 */
export function startLastfmFallback(
  store: ReturnType<typeof createStore>,
  deps: LastfmFallbackDeps,
  host: BiographyHost = fb,
) {
  const need = atom((get) => {
    const artist = get(deps.artist);
    const input = get(deps.input);
    return (
      !!artist &&
      get(deps.enabled) &&
      get(deps.sourcePrefs.source) === 'apple' &&
      get(deps.sourcePrefs.lastfmFallback) &&
      !get(deps.sourcePrefs.lastfmDeclined).includes(artist) &&
      input?.source === 'apple' &&
      !!input.sourceId &&
      get(deps.apple.state).status === 'missing'
    );
  });
  const identity = startBiographyIdentity(
    store,
    {
      artist: deps.artist,
      ...(deps.term ? { term: deps.term } : {}),
      albums: atom((get) => get(deps.albums)?.map((album) => album.name) ?? null),
      manual: deps.manual,
      enabled: need,
      active: deps.active,
      locale: deps.locale,
      resources: deps.resources,
    },
    deps.resources.musicbrainz,
    host,
  );
  const input = atom((get) => {
    const name = get(deps.artist);
    return name && get(need)
      ? lastfmInputOf(name, get(deps.manual), get(identity.state), get(deps.language))
      : null;
  });
  const lastfm = startBiography(
    store,
    {
      enabled: need,
      active: deps.active,
      input,
      fetchText: deps.resources.fetchText,
      sourceKey: deps.lastfmKey,
      resources: deps.resources,
      details: false,
    },
    host,
  );
  const state = atom((get): BiographyState => {
    const apple = get(deps.apple.state);
    if (!get(need)) return apple;
    const own = get(lastfm.state);
    if (own.document)
      return {
        ...apple,
        status: 'ready',
        document: own.document,
        refreshing: own.refreshing,
        stale: own.stale,
        cacheFailed: apple.cacheFailed || own.cacheFailed,
        fallbackProblem: own.problem,
      };
    if (!get(deps.manual)) {
      const found = get(identity.state);
      if (
        found.artist !== get(deps.artist) ||
        found.status === 'idle' ||
        found.status === 'resolving'
      )
        return loading(apple);
      if (found.status === 'failed') return { ...apple, fallbackProblem: found.problem };
      if (found.status !== 'resolved') return apple;
    }
    if (own.status === 'error') return { ...apple, fallbackProblem: own.problem };
    if (own.status === 'missing' || own.status === 'disabled' || own.status === 'cleared')
      return apple;
    return loading(apple);
  });
  const retryFallback = () => {
    const found = store.get(identity.state);
    if (!store.get(deps.manual) && found.status === 'failed') identity.refresh();
    else lastfm.refresh();
  };
  const service: BiographyService = {
    state,
    ready: deps.apple.ready,
    cacheState: deps.apple.cacheState,
    clearCache: () => deps.apple.clearCache(),
    // 正文回退激活时仅刷新 Last.fm 数据；Apple 无正文的判定结果依其自身缓存策略更新
    refresh: () => (store.get(need) ? retryFallback() : deps.apple.refresh()),
    retryFallback,
    dispose() {
      identity.dispose();
      lastfm.dispose();
    },
  };
  return service;
}
