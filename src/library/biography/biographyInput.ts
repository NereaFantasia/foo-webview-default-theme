import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { albumYearOf } from '../../host/libraryContract.ts';
import type { AlbumsState } from '../albums.ts';
import type { AppleLanguage } from './apple/appleClient.ts';
import { startAppleIdentity } from './apple/appleIdentity.ts';
import type { AppleManualIdentity } from './apple/appleIdentityRecord.ts';
import type { LocalAlbum } from './apple/appleMatch.ts';
import { appleFirstPageUrl } from './apple/fetchAppleBiography.ts';
import {
  lastfmInput,
  type BiographyIdentity,
  type BiographyInput,
  type BiographyLanguage,
  type BiographySource,
} from './biographyModel.ts';
import type { BiographyResources } from './biographyResources.ts';
import { startBiographyIdentity } from './identity/biographyIdentity.ts';
import type { BiographyIdentityState } from './identity/identityRecord.ts';

export interface BiographyInputDeps {
  /**
   * 身份的键：认定缓存、手选与状态都按它存取。本地艺人就是艺人名；名字会重名的来源（在线艺人）
   * 另给一个带来源的键，再用 `term` 给出真正要搜的名字
   */
  readonly artist: Atom<string | null>;
  /** 搜索用的艺人名，缺省取 `artist` */
  readonly term?: Atom<string | null>;
  /** 这位艺人自己的专辑，用来在同名候选里认人；还没取到时为 null，等取到再认定 */
  readonly albums: Atom<readonly LocalAlbum[] | null>;
  /** 用哪个来源取简介；只有选中的来源的身份服务会发请求 */
  readonly source: Atom<BiographySource>;
  readonly language: Atom<BiographyLanguage>;
  /** 界面语言，MusicBrainz 挑别名时优先同一种语言的 */
  readonly locale: Atom<string>;
  /** 在线内容开着 */
  readonly enabled: Atom<boolean>;
  /** 简介正在显示 */
  readonly active: Atom<boolean>;
  readonly lastfmManual: Atom<BiographyIdentity | null>;
  readonly appleManual: Atom<AppleManualIdentity | null>;
  readonly resources: BiographyResources;
}

/** 本地专辑艺人归属他的专辑；媒体库还没读完时为 null，等读完再认定 */
export function localAlbumsOf(
  state: AlbumsState,
  artist: string | null,
): readonly LocalAlbum[] | null {
  if (state.status === 'idle' || state.status === 'loading') return null;
  return state.albums
    .filter((album) => album.albumArtist === artist)
    .map((album) => ({
      name: album.name,
      year: Number(albumYearOf(album)) || null,
      trackCount: album.trackCount,
    }));
}

/**
 * Last.fm 来源的输入：手选为准，没有手选时用身份服务认定的那位。手选刚删掉时状态还停在手选那位上，
 * 等身份服务重新认定，不能接着用它
 */
export function lastfmInputOf(
  name: string,
  chosen: BiographyIdentity | null,
  found: BiographyIdentityState,
  language: BiographyLanguage,
): BiographyInput {
  const resolved =
    found.artist === name && found.status === 'resolved' && (chosen || !found.manual)
      ? found
      : null;
  return lastfmInput(name, chosen?.sourceArtist ?? resolved?.sourceArtist ?? null, language);
}

/** Apple 页面只提供默认语言与英文两种，其余语言都取英文，不为 12 种语言键各缓存一份 */
function appleLanguage(language: BiographyLanguage): AppleLanguage {
  return language === 'zh' ? 'zh' : 'en';
}

/**
 * 两处装配（右侧卡与艺人页）共用的接线：创建两个来源的身份服务，按选中的来源产出简介服务的
 * 输入。只比专辑艺人是他的专辑，客串的那张不是他的作品，比对会认错人。身份服务由本函数
 * 创建、释放，简介服务、照片与界面仍由调用方装配
 */
export function startBiographyInput(
  store: ReturnType<typeof createStore>,
  deps: BiographyInputDeps,
) {
  const { artist, resources } = deps;
  const on = (source: BiographySource) =>
    atom((get) => get(deps.enabled) && get(deps.source) === source);
  const lastfmIdentity = startBiographyIdentity(
    store,
    {
      artist,
      ...(deps.term ? { term: deps.term } : {}),
      active: deps.active,
      enabled: on('lastfm'),
      manual: deps.lastfmManual,
      locale: deps.locale,
      resources,
      albums: atom((get) => get(deps.albums)?.map((album) => album.name) ?? null),
    },
    resources.musicbrainz,
  );
  const appleIdentity = startAppleIdentity(
    store,
    {
      artist,
      ...(deps.term ? { term: deps.term } : {}),
      active: deps.active,
      enabled: on('apple'),
      manual: deps.appleManual,
      resources,
      albums: deps.albums,
      language: atom((get) => appleLanguage(get(deps.language))),
      // 名字唯一一致的多半就是他：认定还在比对专辑时先去取页，认定后取简介直接认领这次的结果
      prefetch: (hit, alive) =>
        resources.apple.prefetch(
          appleFirstPageUrl(
            { id: hit.id, name: hit.name, url: hit.url },
            appleLanguage(store.get(deps.language)),
          ),
          alive,
        ),
    },
    resources.apple,
  );
  const input = atom<BiographyInput | null>((get) => {
    const name = get(artist);
    if (!name) return null;
    const language = get(deps.language);
    if (get(deps.source) === 'lastfm')
      return lastfmInputOf(name, get(deps.lastfmManual), get(lastfmIdentity.state), language);
    const chosen = get(deps.appleManual);
    const found = get(appleIdentity.state);
    const resolved =
      found.artist === name && found.status === 'resolved' && (chosen || !found.manual)
        ? found
        : null;
    // 手选了「这些都不是」的不显示简介，也不用自动认定的那位顶替
    const picked = chosen ? (chosen.declined ? null : chosen) : resolved;
    return {
      artist: name,
      source: 'apple',
      sourceId: picked?.sourceId ?? null,
      sourceArtist: picked?.sourceArtist ?? null,
      ...(picked?.url ? { sourceUrl: picked.url } : {}),
      language: appleLanguage(language),
    };
  });
  return {
    lastfmIdentity,
    appleIdentity,
    input,
    dispose() {
      lastfmIdentity.dispose();
      appleIdentity.dispose();
    },
  };
}

export type BiographyInputWiring = ReturnType<typeof startBiographyInput>;
