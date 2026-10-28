import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useMemo, useState } from 'react';
import { useService } from '../../kit/useService.ts';
import type { MusicAlbum, MusicAlbumSubType, MusicRef } from '../../server/musicObjects.ts';
import { artistAlbumSearchKey, artistAlbumSearchKeyOf } from './artistAlbumSearch.ts';
import { artistAlbumsKey, artistAlbumsKeyOf, type ArtistAlbumsState } from './artistAlbums.ts';
import {
  DEFAULT_RELEASE_SORT,
  findReleases,
  kindOptions,
  layoutReleases,
  mergeReleases,
  naturalRelease,
  sortReleases,
  versionOptions,
  withKinds,
  withVersions,
  type KindOption,
  type ReleaseKind,
  type ReleaseLayout,
  type ReleaseSort,
  type ReleaseSortField,
  type VersionOption,
} from './artistReleases.ts';

export type ArtistTab = 'songs' | 'albums' | 'singles';
type ReleaseTab = Exclude<ArtistTab, 'songs'>;

/** 专辑页签与「单曲与 EP」页签各自维护检索、排序、种类与版本过滤状态 */
export interface ReleaseView {
  readonly query: string;
  readonly sort: ReleaseSort;
  readonly kinds: ReadonlySet<ReleaseKind>;
  readonly versions: ReadonlySet<MusicAlbumSubType>;
}

const FRESH: ReleaseView = {
  query: '',
  sort: DEFAULT_RELEASE_SORT,
  kinds: new Set(),
  versions: new Set(),
};

/** 页签内小节定义：专辑页签包含正文、合集与参与专辑，「单曲与 EP」仅单节 */
export interface ReleaseSection {
  readonly key: 'albums' | 'compilations' | 'featured' | 'singles';
  readonly albums: readonly MusicAlbum[];
}

/** 搜索输入防抖延迟，单位毫秒 */
const SEARCH_DELAY_MS = 400;

/** 艺人专辑超出数量限制时的联网搜索状态 */
export interface ReleaseSearch {
  /** 检索是否触发联网：专辑超出单次拉取限制且包含查询词、未勾选特定版本 */
  readonly active: boolean;
  /** 搜索是否在等待或进行中；结果到达前不呈现无结果空状态 */
  readonly busy: boolean;
  /** 搜索首页或后续分页加载失败 */
  readonly failed: boolean;
  /** 搜索是否存在后续分页可供加载 */
  readonly more: boolean;
}

/** 页面切换现场快照，离开时保存、返回时恢复 */
export interface ArtistSnapshot {
  readonly tab: ArtistTab;
  readonly views: Readonly<Record<ReleaseTab, ReleaseView>>;
}

export interface ArtistReleases {
  readonly state: ArtistAlbumsState | undefined;
  /** 已获取专辑的分组布局；未完成初始化时为 null */
  readonly layout: ReleaseLayout | null;
  /** 当前可用页签列表；加载阶段全部展示，完成后移除无数据页签 */
  readonly tabs: readonly ArtistTab[];
  readonly tab: ArtistTab;
  /** 当前激活页签的检索、排序、种类与版本过滤状态 */
  readonly view: ReleaseView;
  /** 当前页签应用过滤与排序后的展示小节列表；空节自动剔除 */
  readonly sections: readonly ReleaseSection[];
  /**
   * 筛选面板各栏目选项与计数
   * 两栏计数相互联动：计数依据另一栏选中项动态计算，等于 0 项自动隐藏（已勾选项除外）
   */
  readonly facets: {
    readonly kinds: { readonly shown: boolean; readonly options: readonly KindOption[] };
    readonly versions: { readonly shown: boolean; readonly options: readonly VersionOption[] };
  };
  /** 当前页签过滤后的匹配专辑总数 */
  readonly count: number;
  /** 有查找词或种类、版本筛选：筛出来的结果不靠滚动自动续取，由用户点加载更多 */
  readonly filtering: boolean;
  readonly search: ReleaseSearch;
  setTab(tab: ArtistTab): void;
  setQuery(query: string): void;
  setSort(field: ReleaseSortField, descending: boolean): void;
  toggleKind(kind: ReleaseKind): void;
  toggleVersion(version: MusicAlbumSubType): void;
  clearFacets(): void;
  retry(): void;
  /** 滚动触底时触发续取后续分页 */
  loadMore(): void;
  searchMore(): void;
  searchRetry(): void;
  capture(): ArtistSnapshot;
  restore(snapshot: ArtistSnapshot): void;
}

/** 只看艺人专辑页签里的一节（专辑墙页）：页签固定在专辑，只留这一节，查找、排序与版本筛选从概览带来 */
export interface ReleaseFocus {
  readonly section: ReleaseSection['key'];
  readonly initial: Pick<ReleaseView, 'query' | 'sort' | 'versions'>;
}

/**
 * 在线艺人专辑页签数据与交互状态 hook
 * 挂载时立即请求艺人专辑以推断可用页签；artist 为 null 时不执行请求
 */
export function useArtistReleases(
  artist: MusicRef | null,
  name: string,
  locale: string,
  focus?: ReleaseFocus,
): ArtistReleases {
  const service = useService(artistAlbumsKey);
  const platform = artist?.platform;
  const id = artist?.id;
  const ref = useMemo(() => (platform && id ? { platform, id } : null), [platform, id]);
  useEffect(() => (ref ? service.want(ref) : undefined), [service, ref]);
  const states = useAtomValueRawSync(service.artists);
  const state = ref ? states.get(artistAlbumsKeyOf(ref)) : undefined;
  const ready = state?.phase === 'ready';
  const albums = state?.albums;
  const layout = useMemo(
    () => (ready && ref && albums ? layoutReleases(albums, ref) : null),
    [ready, ref, albums],
  );

  const [tab, setTabState] = useState<ArtistTab>(focus ? 'albums' : 'songs');
  const [views, setViews] = useState<Readonly<Record<ReleaseTab, ReleaseView>>>(() => ({
    albums: focus ? { ...FRESH, ...focus.initial } : FRESH,
    singles: FRESH,
  }));
  const offered = !!ref && !(state?.phase === 'failed' && state.failure === 'unsupported');
  const tabs = useMemo<readonly ArtistTab[]>(() => {
    if (!offered) return ['songs'];
    if (!layout) return ['songs', 'albums', 'singles'];
    const hasAlbums =
      layout.albums.length + layout.compilations.length + layout.featured.length > 0;
    return [
      'songs',
      ...(hasAlbums ? ['albums' as const] : []),
      ...(layout.singles.length > 0 ? ['singles' as const] : []),
    ];
  }, [offered, layout]);
  const active: ArtistTab = tabs.includes(tab)
    ? tab
    : tab === 'singles' && tabs.includes('albums')
      ? 'albums'
      : 'songs';
  const releaseTab = active === 'songs' ? null : active;
  const view = releaseTab ? views[releaseTab] : FRESH;
  const collator = useMemo(
    () => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }),
    [locale],
  );

  // 专辑数量超出拉取上限时，防抖触发联网检索补全；当勾选版本筛选时，因上游检索结果缺少版本字段而跳过联网请求
  const searchService = useService(artistAlbumSearchKey);
  const searchStates = useAtomValueRawSync(searchService.searches);
  const text = view.query.trim();
  const online =
    releaseTab !== null &&
    ref !== null &&
    name !== '' &&
    text !== '' &&
    view.versions.size === 0 &&
    state?.phase === 'ready' &&
    state.cursor !== null;
  const [settled, setSettled] = useState('');
  useEffect(() => {
    if (!online) return;
    const timer = setTimeout(() => setSettled(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [online, text]);
  const settledText = online ? settled : '';
  const query = useMemo(
    () => (ref && settledText !== '' ? { artist: ref, name, text: settledText } : null),
    [ref, name, settledText],
  );
  useEffect(() => (query ? searchService.want(query) : undefined), [searchService, query]);
  const remote = query ? searchStates.get(artistAlbumSearchKeyOf(query)) : undefined;
  const extras = useMemo(() => {
    if (!remote || !online) return [];
    const loaded = new Set(albums?.map((album) => album.ref.id));
    return findReleases(
      remote.albums.filter((album) => !loaded.has(album.ref.id)),
      text,
    );
  }, [remote, online, albums, text]);
  const merged = useMemo(
    () => (layout && ref ? mergeReleases(layout, extras, ref) : layout),
    [layout, extras, ref],
  );

  const parts = useMemo<readonly ReleaseSection[]>(() => {
    if (!merged || !releaseTab) return [];
    const all: readonly ReleaseSection[] =
      releaseTab === 'albums'
        ? [
            { key: 'albums', albums: merged.albums },
            { key: 'compilations', albums: merged.compilations },
            { key: 'featured', albums: merged.featured },
          ]
        : [{ key: 'singles', albums: merged.singles }];
    return focus ? all.filter((part) => part.key === focus.section) : all;
  }, [merged, releaseTab, focus]);
  const facets = useMemo(() => {
    const all = parts.flatMap((part) => part.albums);
    const { kinds, versions } = view;
    return {
      kinds: {
        shown: kinds.size > 0 || kindOptions(all).length >= 2,
        options: kindOptions(withVersions(all, versions), kinds),
      },
      versions: {
        shown: versions.size > 0 || versionOptions(all).length >= 2,
        options: versionOptions(withKinds(all, kinds), versions),
      },
    };
  }, [parts, view]);
  const sections = useMemo(
    () =>
      parts
        .map((part) => ({
          key: part.key,
          albums: sortReleases(
            withKinds(
              withVersions(findReleases(part.albums, view.query), view.versions),
              view.kinds,
            ),
            view.sort,
            collator,
          ),
        }))
        .filter((section) => section.albums.length > 0),
    [parts, view, collator],
  );

  const update = (change: (current: ReleaseView) => ReleaseView) => {
    if (releaseTab) setViews((all) => ({ ...all, [releaseTab]: change(all[releaseTab]) }));
  };
  return {
    state,
    layout,
    tabs,
    tab: active,
    view,
    sections,
    facets,
    count: sections.reduce((sum, section) => sum + section.albums.length, 0),
    filtering: text !== '' || view.kinds.size > 0 || view.versions.size > 0,
    search: {
      active: online,
      busy:
        online &&
        (settledText !== text || !remote || remote.phase === 'searching' || remote.loadingMore),
      failed: !!remote && (remote.phase === 'failed' || remote.moreFailed),
      more:
        remote?.phase === 'ready' &&
        remote.cursor !== null &&
        !remote.loadingMore &&
        !remote.moreFailed,
    },
    setTab: setTabState,
    setQuery(query) {
      update((current) => ({ ...current, query }));
    },
    // 换字段时用那个字段惯用的方向，只翻方向时照点的来
    setSort(field, descending) {
      update((current) => ({
        ...current,
        sort: field === current.sort.field ? { field, descending } : naturalRelease(field),
      }));
    },
    toggleKind(kind) {
      update((current) => {
        const kinds = new Set(current.kinds);
        if (kinds.has(kind)) kinds.delete(kind);
        else kinds.add(kind);
        return { ...current, kinds };
      });
    },
    toggleVersion(version) {
      update((current) => {
        const versions = new Set(current.versions);
        if (versions.has(version)) versions.delete(version);
        else versions.add(version);
        return { ...current, versions };
      });
    },
    clearFacets() {
      update((current) => ({ ...current, kinds: new Set(), versions: new Set() }));
    },
    retry() {
      if (ref) service.retry(ref);
    },
    loadMore() {
      if (ref) service.more(ref);
    },
    searchMore() {
      if (query) searchService.more(query);
    },
    searchRetry() {
      if (query) searchService.retry(query);
    },
    capture: () => ({ tab: active, views }),
    restore(snapshot) {
      setTabState(snapshot.tab);
      setViews(snapshot.views);
    },
  };
}
