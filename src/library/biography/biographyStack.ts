import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import type { LocalAlbum } from './apple/appleMatch.ts';
import { startBiography } from './biographyService.ts';
import { startBiographyInput } from './biographyInput.ts';
import type { BiographyLanguage } from './biographyModel.ts';
import type { BiographyPrefsService } from './biographyPrefs.ts';
import type { BiographyResources } from './biographyResources.ts';
import type { BiographySourcePrefsService } from './biographySourcePrefs.ts';
import { startBiographyMotion } from './online/biographyMotion.ts';
import { startBiographyOnlinePhoto } from './online/biographyOnlinePhoto.ts';
import { appleHeroOf } from './online/fetchApplePhoto.ts';
import { onlinePhotoOf, onlinePhotoReady } from './online/onlinePhotoSource.ts';
import type { LastfmKeyService } from './lastfm-api/lastfmKey.ts';
import { startLastfmFallback } from './lastfmFallback.ts';
import { biographySearching } from './biographySearching.ts';

/** 跨模块共享的简介资源与配置项，由 `app/` 统一初始化并在此只读使用 */
export interface BiographyStackShared {
  readonly prefs: BiographyPrefsService;
  readonly sourcePrefs: BiographySourcePrefsService;
  readonly resources: BiographyResources;
  readonly lastfmKey: LastfmKeyService;
  readonly language: Atom<BiographyLanguage>;
  readonly locale: Atom<string>;
  readonly probe: (url: string) => Promise<Uint8ClampedArray | null>;
  /** 「动态艺术照」开关 */
  readonly motionEnabled: Atom<boolean>;
}

export interface BiographyStackDeps extends BiographyStackShared {
  /** 艺人身份键名：用于索引认定缓存、用户手动指定项及拉取状态；本地艺人采用艺人名，同名冲突源使用带前缀的唯一键 */
  readonly subject: Atom<string | null>;
  /** 检索使用的艺人名称，缺省取 `subject` */
  readonly term?: Atom<string | null>;
  readonly active: Atom<boolean>;
  /** 艺人名下专辑列表，用于在同名候选人中辅助身份消歧；未就绪时为 null */
  readonly albums: Atom<readonly LocalAlbum[] | null>;
  /**
   * 只要艺术照：不拉宽幅头图与动态艺术照，不取 Last.fm 的相册页与相册里的图，也不为补正文去取
   * Last.fm。这几样只有整页简介才用，头像之类只要一张图的地方不该为它们下载
   */
  readonly photoOnly?: boolean;
}

/**
 * 装配单艺人简介全套服务：包含身份认定、正文拉取、Apple 缺失时的 Last.fm 回退、艺术照及宽幅头图
 *
 * 供本地艺人页与在线艺人页共用；本地特有的照片扫描与相似艺人图由外部另行装配；服务由本函数统一创建与释放
 */
export function startBiographyStack(
  store: ReturnType<typeof createStore>,
  deps: BiographyStackDeps,
) {
  // 等待数据源偏好加载完成后再启用拉取，避免偏好为 Last.fm 的用户在初始阶段误发 Apple 请求
  const enabled = atom((get) => get(deps.prefs.state).enabled && get(deps.sourcePrefs.loaded));
  const manual = atom(
    (get) =>
      get(deps.prefs.state).identities.find((item) => item.artist === get(deps.subject)) ?? null,
  );
  const appleManual = atom(
    (get) =>
      get(deps.sourcePrefs.identities).find((item) => item.artist === get(deps.subject)) ?? null,
  );
  const wiring = startBiographyInput(store, {
    artist: deps.subject,
    ...(deps.term ? { term: deps.term } : {}),
    albums: deps.albums,
    source: deps.sourcePrefs.source,
    language: deps.language,
    locale: deps.locale,
    enabled,
    active: deps.active,
    lastfmManual: manual,
    appleManual,
    resources: deps.resources,
  });
  const identity = wiring.lastfmIdentity;
  const input = wiring.input;
  // 热门曲目、缺失专辑与相似艺人需使用 Last.fm 规范名；当前源非 Last.fm 时置空，避免使用 Apple 显示名误查
  const sourceArtist = atom((get) => {
    const current = get(input);
    return current?.source === 'lastfm' ? current.sourceArtist : null;
  });
  const source = deps.resources.lastfm;
  const service = startBiography(
    store,
    {
      input,
      enabled,
      active: deps.active,
      resources: deps.resources,
      fetchText: deps.resources.fetchText,
      sourceKey: deps.lastfmKey.key,
    },
    undefined,
    undefined,
    source.fetchDetails,
  );
  // 关于面板展示正文：Apple 无正文时回退至 Last.fm，照片与曲风元数据仍保持 Apple 源
  const text = startLastfmFallback(store, {
    artist: deps.subject,
    ...(deps.term ? { term: deps.term } : {}),
    albums: deps.albums,
    active: deps.photoOnly ? atom(false) : deps.active,
    enabled,
    input,
    apple: service,
    sourcePrefs: deps.sourcePrefs,
    manual,
    language: deps.language,
    locale: deps.locale,
    lastfmKey: deps.lastfmKey.key,
    resources: deps.resources,
  });
  const photoSource = atom((get) =>
    get(enabled) ? onlinePhotoOf(get(input), get(service.state)) : null,
  );
  const ready = atom((get) => onlinePhotoReady(get(service.state)));
  const onlinePhoto = startBiographyOnlinePhoto(store, {
    source: photoSource,
    active: deps.active,
    probe: deps.probe,
    // 给了 Last.fm 艺人名就会连相册页一起取、把相册里的图全下载，只要一张艺术照时不给
    ...(deps.photoOnly ? {} : { artist: atom((get) => (get(enabled) ? get(sourceArtist) : null)) }),
    language: deps.language,
    cache: deps.resources.photos,
    ready,
  });
  // 头部宽幅图：仅由特定数据源提供，与普通艺术照独立拉取并共享图像缓存
  const heroSource = atom((get) => {
    const photo = get(photoSource);
    return !deps.photoOnly && photo?.source === 'apple' ? appleHeroOf(photo) : null;
  });
  const hero = startBiographyOnlinePhoto(store, {
    source: heroSource,
    active: deps.active,
    probe: deps.probe,
    cache: deps.resources.photos,
    ready,
  });
  // 当前已认定艺人的 Apple 数据：仅在数据源匹配且身份认定一致时提供
  const appleDocument = atom((get) => {
    const current = get(input);
    const document = get(service.state).document;
    return current?.source === 'apple' &&
      current.sourceId &&
      document?.source === 'apple' &&
      document.sourceId === current.sourceId
      ? document
      : null;
  });
  // 头部宽幅动态艺术照与艺术字图像：仅在页面元数据包含时提供
  const clip = atom((get) => get(appleDocument)?.motion?.wide ?? null);
  const logo = atom((get) => get(appleDocument)?.logo ?? null);
  const motion = startBiographyMotion(store, {
    clip,
    enabled: atom(
      (get) =>
        !deps.photoOnly && get(enabled) && get(deps.motionEnabled) && !get(reducedMotionAtom),
    ),
    active: deps.active,
    width: () => globalThis.innerWidth || 1280,
  });
  // 供头部照片按钮展示加载状态，全部数据段完成后恢复图标
  const searching = biographySearching({
    enabled,
    active: deps.active,
    subject: deps.subject,
    identity: atom((get) =>
      get(deps.sourcePrefs.source) === 'apple'
        ? get(wiring.appleIdentity.state)
        : get(identity.state),
    ),
    input,
    ready,
    images: [
      { source: photoSource, state: onlinePhoto.state },
      { source: heroSource, state: hero.state },
    ],
  });
  /** 宽幅图加载完成前头部预铺的背景底色 */
  const heroColor = atom((get) => {
    const photo = get(photoSource);
    return photo?.source === 'apple' ? (photo.wide?.color ?? null) : null;
  });
  const stops = [
    store.sub(text.state, () => {
      const state = store.get(text.state);
      for (const problem of [state.problem, state.detailsProblem, state.fallbackProblem])
        if (problem === 'keyInvalid' || problem === 'keySuspended') deps.lastfmKey.report(problem);
    }),
    store.sub(deps.resources.textRevision, () => {
      onlinePhoto.clear();
      hero.clear();
    }),
  ];
  return {
    enabled,
    input,
    sourceArtist,
    identity,
    appleIdentity: wiring.appleIdentity,
    service: text,
    photoSource,
    onlinePhoto,
    searching,
    /** 头部铺满宽幅图：存在宽幅图时 `heroSource` 非空，`hero.state` 反映图像拉取进度 */
    heroSource,
    hero,
    heroColor,
    /** 艺术字图片（纯白透明艺人名标识，特定数据源提供） */
    logo,
    /** 动态艺术照：`state.url` 提供可用于 `<video src>` 的 mp4 播放地址 */
    motion,
    refresh() {
      identity.refresh();
      text.refresh();
      onlinePhoto.refresh();
      hero.refresh();
    },
    dispose() {
      stops.forEach((stop) => stop());
      wiring.dispose();
      text.dispose();
      service.dispose();
      onlinePhoto.dispose();
      hero.dispose();
      motion.dispose();
    },
  };
}

export type BiographyStack = ReturnType<typeof startBiographyStack>;
