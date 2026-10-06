import type { ConfigWriter } from '../../host/configWrite.ts';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { ConfigPrefFace, ConfigPersistence } from '../../host/configPref.ts';
import type { Store } from '../../kit/store.ts';
import { albumsAtom, startAlbums, type AlbumsFace } from '../albums.ts';
import { albumSearchHitsAtom, startAlbumSearchHits } from './albumSearchHits.ts';
import type { AlbumSearchHitsFace } from './albumSearchHits.ts';
import { filterAlbums, sectionAlbums, sortAlbums, type AlbumSection } from '../albumSections.ts';
import { artistCreditsAtom, startArtistCredits } from './artistCredits.ts';
import type { ArtistCreditsFace } from './artistCredits.ts';
import { browserPrefsAtom } from './browserPrefs.ts';
import {
  collapsedSectionsAtom,
  startCollapsedSections,
  type CollapsedSections,
} from './collapsedSections.ts';
import { albumKeyOf, type Album } from '../../host/libraryContract.ts';
import {
  applyFacets,
  EMPTY_FACET_SELECTION,
  facetOptionsOf,
  hasFacetSelection,
  pruneFacetSelection,
  toggleFacet,
  type FacetField,
  type FacetOptions,
  type FacetSelection,
} from './facets.ts';
import { libraryRootsAtom, startLibraryRoots, type LibraryRootsFace } from './libraryRoots.ts';

// 专辑页的浏览状态：清单 → 筛选 → 过滤 → 排序 → 分节。换分节、换排序都不打宿主；打宿主的是清单
// 本身、过滤词的曲目级命中、库根、艺术家档的署名表与折叠状态，各归各的服务。
// 过滤词与筛选的勾选只活在这一次运行里；折叠了哪些节写进 config，跨重启记住。

/**
 * 此刻画哪一态。disabled：库没开，先于一切；loading：首次读取还没回来，或分节依据要的数据还在等；
 * empty：库开着但一张都没有；noMatch：有清单、过滤后一张不剩，曲目级命中还在路上时不判；
 * ready：照常画，读取失败（另有横幅）与宿主未连接也归这里。
 */
export type BrowsePhase = 'disabled' | 'loading' | 'empty' | 'noMatch' | 'ready';

export interface AlbumBrowseState {
  readonly term: string;
  readonly facets: FacetSelection;
  /** 当前分节依据下折叠了的节，按节键；null 是「未知」节。 */
  readonly collapsed: ReadonlySet<string | null>;
  readonly sections: readonly AlbumSection[];
  /** 平铺档只有一个键为 null 的节，不画节头。 */
  readonly headers: boolean;
  /** 艺术家档里一张专辑可能出现在几节。 */
  readonly repeats: boolean;
  /** 过滤后有几张；艺术家档里一张占几块也只算一张。 */
  readonly shown: number;
  readonly phase: BrowsePhase;
}

const termAtom = atom('');
const facetSelectionAtom = atom<FacetSelection>(EMPTY_FACET_SELECTION);

export const facetOptionsAtom: Atom<FacetOptions> = atom((get) =>
  facetOptionsOf(get(albumsAtom).albums),
);

const filteredAtom = atom((get) => {
  const selection = get(facetSelectionAtom);
  const faceted = applyFacets(get(albumsAtom).albums, selection);
  const filtered = filterAlbums(faceted, get(termAtom), get(albumSearchHitsAtom).hits);
  return sortAlbums(filtered, get(browserPrefsAtom).sort);
});

/**
 * 当前分节依据要的外部数据到没到：艺术家档等署名表（读失败是 failed），一级目录档等库根那一次读取，
 * 其余档不用等。没到时一节都不出，骨架与横幅由 phase 与界面画。
 */
const sectioningAtom = atom((get): 'waiting' | 'failed' | 'ready' => {
  const dimension = get(browserPrefsAtom).dimension;
  if (dimension === 'libraryRoot') return get(libraryRootsAtom).loaded ? 'ready' : 'waiting';
  if (dimension !== 'artist') return 'ready';
  const credits = get(artistCreditsAtom);
  if (credits.credits !== null) return 'ready';
  return credits.status === 'failed' ? 'failed' : 'waiting';
});

/**
 * 分节已经排定：清单读回过，当前分节依据要的数据也到了。没排定时看得见的专辑是临时的空清单，
 * 多选不按它剔选中。
 */
export const sectionsSettledAtom: Atom<boolean> = atom((get) => {
  const status = get(albumsAtom).status;
  return (status === 'ready' || status === 'failed') && get(sectioningAtom) === 'ready';
});

const sectionsAtom = atom((get): readonly AlbumSection[] => {
  if (get(sectioningAtom) !== 'ready') return [];
  const credits = get(artistCreditsAtom).credits;
  const roots = get(libraryRootsAtom);
  return sectionAlbums(get(filteredAtom), get(browserPrefsAtom).dimension, {
    roots: roots.roots,
    relativeBase: roots.relativeBase,
    creditsOf: (album) => credits?.get(albumKeyOf(album)) ?? [],
  });
});

const phaseAtom = atom((get): BrowsePhase => {
  const albums = get(albumsAtom);
  const count = albums.albums.length;
  if (!albums.enabled) return 'disabled';
  if (albums.status === 'loading' && count === 0) return 'loading';
  if (get(sectioningAtom) === 'waiting' && count > 0) return 'loading';
  if (albums.status === 'ready' && count === 0) return 'empty';
  const filtering = get(termAtom).trim() !== '' || hasFacetSelection(get(facetSelectionAtom));
  const pending = get(albumSearchHitsAtom).pending;
  if (count > 0 && get(filteredAtom).length === 0 && filtering && !pending) return 'noMatch';
  return 'ready';
});

export const albumBrowseAtom: Atom<AlbumBrowseState> = atom((get) => {
  const dimension = get(browserPrefsAtom).dimension;
  return {
    term: get(termAtom),
    facets: get(facetSelectionAtom),
    collapsed: get(collapsedSectionsAtom),
    sections: get(sectionsAtom),
    headers: dimension !== 'album',
    repeats: dimension === 'artist',
    shown: get(filteredAtom).length,
    phase: get(phaseAtom),
  };
});

/** 看得见的专辑按阅读顺序排开，折叠的节不算；艺术家档的副本各占一位。多选按它记。 */
export const visibleAlbumsAtom: Atom<readonly Album[]> = atom((get) => {
  const { sections, collapsed, headers } = get(albumBrowseAtom);
  return sections.flatMap((section) =>
    headers && collapsed.has(section.key) ? [] : section.albums,
  );
});

export type AlbumBrowseFace = AlbumsFace &
  LibraryRootsFace &
  ArtistCreditsFace &
  AlbumSearchHitsFace &
  ConfigPrefFace;

export interface AlbumBrowseService {
  readonly persistence: ConfigPersistence;
  /** 连上宿主、清单、库根与折叠状态的初读做完时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  setTerm(term: string): void;
  toggleFacet(field: FacetField, name: string): void;
  clearFacets(): void;
  /** 折叠或展开当前分节依据下的一节，并记进 config；平铺档没有节可折。 */
  toggleSection(key: string | null): void;
  /** 改折叠存档的整份并记进 config：列表形态的两层开合走这里。 */
  updateCollapsed(change: (value: CollapsedSections) => CollapsedSections): void;
  /** 失败横幅上的重试：重读专辑清单，署名表失败过的一并重读。 */
  retry(): Promise<void>;
  dispose(): void;
}

/**
 * 启动专辑页的浏览：专辑清单、库根、署名表、曲目级命中与折叠状态五个服务在这里一起起停。
 * 分节依据与排序取自 `browserPrefsAtom`，要先启动偏好服务。
 */
export function startAlbumBrowse(
  store: Store,
  host: AlbumBrowseFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
): AlbumBrowseService {
  store.set(termAtom, '');
  store.set(facetSelectionAtom, EMPTY_FACET_SELECTION);
  const albums = startAlbums(store, host);
  const roots = startLibraryRoots(store, host);
  const credits = startArtistCredits(store, host);
  const hits = startAlbumSearchHits(store, host);
  const collapsed = startCollapsedSections(store, host, writer);
  let disposed = false;
  // 库变了之后筛选里已经没有的值剔掉，否则筛出 0 张，又没有可以取消的那一项。
  const offOptions = store.sub(facetOptionsAtom, () => {
    const current = store.get(facetSelectionAtom);
    const next = pruneFacetSelection(current, store.get(facetOptionsAtom));
    if (next !== current) store.set(facetSelectionAtom, next);
  });

  return {
    ready: Promise.all([albums.ready, roots.ready, collapsed.ready]).then(() => {}),
    persistence: collapsed.persistence,
    setTerm(term) {
      if (disposed || term === store.get(termAtom)) return;
      store.set(termAtom, term);
      hits.search(term);
    },
    toggleFacet(field, name) {
      if (disposed) return;
      store.set(facetSelectionAtom, toggleFacet(store.get(facetSelectionAtom), field, name));
    },
    clearFacets() {
      if (!disposed) store.set(facetSelectionAtom, EMPTY_FACET_SELECTION);
    },
    toggleSection(key) {
      if (!disposed) collapsed.toggle(key);
    },
    updateCollapsed(change) {
      if (!disposed) collapsed.update(change);
    },
    async retry() {
      if (disposed) return;
      const creditsFailed = store.get(artistCreditsAtom).status === 'failed';
      await Promise.all([albums.retry(), creditsFailed ? credits.retry() : undefined]);
    },
    dispose() {
      disposed = true;
      offOptions();
      collapsed.dispose();
      hits.dispose();
      credits.dispose();
      roots.dispose();
      albums.dispose();
    },
  };
}
