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

/** 专辑墙页里检索、排序、种类与版本过滤的状态 */
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

/** 艺人发行的一节：专辑、合集、参与的专辑或「单曲与 EP」 */
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

/** 专辑墙页的现场快照，离开时保存、返回时恢复 */
export interface ArtistSnapshot {
  readonly view: ReleaseView;
}

/** 一位艺人的发行列表与它的分组，概览页与专辑墙页共用 */
export interface ArtistLayout {
  /** 平台与艺人 ID 都有才有；没有时不取 */
  readonly ref: MusicRef | null;
  readonly state: ArtistAlbumsState | undefined;
  /** 已获取专辑的分组布局；未取完时为 null */
  readonly layout: ReleaseLayout | null;
  retry(): void;
  /** 续取后续分页 */
  more(): void;
}

/** 请求这位艺人的发行列表并分组；挂载时立即请求，artist 为 null 时不请求 */
export function useArtistLayout(artist: MusicRef | null): ArtistLayout {
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
  return {
    ref,
    state,
    layout,
    retry() {
      if (ref) service.retry(ref);
    },
    more() {
      if (ref) service.more(ref);
    },
  };
}

export interface ArtistReleases {
  readonly state: ArtistAlbumsState | undefined;
  readonly section: ReleaseSection['key'];
  readonly view: ReleaseView;
  /** 应用过滤与排序后的这一节；空节自动剔除 */
  readonly sections: readonly ReleaseSection[];
  /**
   * 筛选面板各栏目选项与计数
   * 两栏计数相互联动：计数依据另一栏选中项动态计算，等于 0 项自动隐藏（已勾选项除外）
   */
  readonly facets: {
    readonly kinds: { readonly shown: boolean; readonly options: readonly KindOption[] };
    readonly versions: { readonly shown: boolean; readonly options: readonly VersionOption[] };
  };
  /** 过滤后的匹配专辑总数 */
  readonly count: number;
  /** 有查找词或种类、版本筛选：筛出来的结果不靠滚动自动续取，由用户点加载更多 */
  readonly filtering: boolean;
  readonly search: ReleaseSearch;
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

/** 专辑墙页只看艺人发行的一节，查找、排序与版本筛选从概览带来 */
export interface ReleaseFocus {
  readonly section: ReleaseSection['key'];
  readonly initial: Pick<ReleaseView, 'query' | 'sort' | 'versions'>;
}

/** 专辑墙页的数据与交互状态：只看 `focus` 那一节，在它上面检索、排序与筛选 */
export function useArtistReleases(
  artist: MusicRef | null,
  name: string,
  locale: string,
  focus: ReleaseFocus,
): ArtistReleases {
  const { ref, state, layout, retry, more } = useArtistLayout(artist);
  const albums = state?.albums;
  const [view, setView] = useState<ReleaseView>(() => ({ ...FRESH, ...focus.initial }));
  const collator = useMemo(
    () => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }),
    [locale],
  );

  // 专辑数量超出拉取上限时，防抖触发联网检索补全；当勾选版本筛选时，因上游检索结果缺少版本字段而跳过联网请求
  const searchService = useService(artistAlbumSearchKey);
  const searchStates = useAtomValueRawSync(searchService.searches);
  const text = view.query.trim();
  const online =
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

  const part = useMemo<ReleaseSection | null>(
    () => (merged ? { key: focus.section, albums: merged[focus.section] } : null),
    [merged, focus.section],
  );
  const facets = useMemo(() => {
    const all = part?.albums ?? [];
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
  }, [part, view]);
  const sections = useMemo(() => {
    if (!part) return [];
    const shown = sortReleases(
      withKinds(withVersions(findReleases(part.albums, view.query), view.versions), view.kinds),
      view.sort,
      collator,
    );
    return shown.length > 0 ? [{ key: part.key, albums: shown }] : [];
  }, [part, view, collator]);

  const update = (change: (current: ReleaseView) => ReleaseView) => setView(change);
  return {
    state,
    section: focus.section,
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
    retry,
    loadMore: more,
    searchMore() {
      if (query) searchService.more(query);
    },
    searchRetry() {
      if (query) searchService.retry(query);
    },
    capture: () => ({ view }),
    restore(snapshot) {
      setView(snapshot.view);
    },
  };
}
