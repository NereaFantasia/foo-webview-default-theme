import type { SectionDimension } from '../albumSections.ts';
import { COLLAPSED_LIMIT, type CollapsedSections } from '../albums/collapsedSections.ts';

// 列表形态的两层折叠怎么读、怎么改：节按分节依据记折叠了的，专辑分组记「缺省折不折」加上与缺省相反的
// 那些专辑键（新加的专辑随缺省）。都是纯函数，答新的一份，原来的不改；写进 config 归折叠服务。

export interface ListCollapse {
  /** 当前分节依据下折叠了的节；平铺档恒为空。 */
  readonly sections: ReadonlySet<string | null>;
  readonly collapsedByDefault: boolean;
  /** 与缺省相反的专辑，按专辑键。 */
  readonly except: ReadonlySet<string>;
}

/** 一节里有哪些专辑：批量开合要知道此刻有哪些节、节里是哪几张。 */
export interface ListSectionKeys {
  readonly key: string | null;
  readonly albums: readonly string[];
}

export function listCollapseOf(
  value: CollapsedSections,
  dimension: SectionDimension,
): ListCollapse {
  const sections = dimension === 'album' ? [] : (value.list?.[dimension] ?? []);
  return {
    sections: new Set(sections),
    collapsedByDefault: value.listAlbums?.collapsedByDefault ?? false,
    except: new Set(value.listAlbums?.except ?? []),
  };
}

export function isAlbumCollapsed(collapse: ListCollapse, albumKey: string): boolean {
  return collapse.collapsedByDefault !== collapse.except.has(albumKey);
}

/** 把这几节设成折叠或展开。平铺档没有节，原样答回。 */
export function withSections(
  value: CollapsedSections,
  dimension: SectionDimension,
  keys: readonly (string | null)[],
  collapsed: boolean,
): CollapsedSections {
  if (dimension === 'album') return value;
  const touched = new Set(keys);
  const rest = (value.list?.[dimension] ?? []).filter((key) => !touched.has(key));
  const next = collapsed ? [...rest, ...touched] : rest;
  return { ...value, list: { ...value.list, [dimension]: next.slice(-COLLAPSED_LIMIT) } };
}

/** 把这几张专辑设成折叠或展开：与缺省相同的从例外里去掉，不同的记进例外（超出上限丢最早记的）。 */
export function withAlbums(
  value: CollapsedSections,
  keys: readonly string[],
  collapsed: boolean,
): CollapsedSections {
  const collapsedByDefault = value.listAlbums?.collapsedByDefault ?? false;
  const touched = new Set(keys);
  const rest = (value.listAlbums?.except ?? []).filter((key) => !touched.has(key));
  const except = collapsed === collapsedByDefault ? rest : [...rest, ...touched];
  return {
    ...value,
    listAlbums: { collapsedByDefault, except: except.slice(-COLLAPSED_LIMIT) },
  };
}

/** 所有专辑（连同以后新加的）一律折叠或展开，例外清空。 */
export function withAllAlbums(value: CollapsedSections, collapsed: boolean): CollapsedSections {
  return { ...value, listAlbums: { collapsedByDefault: collapsed, except: [] } };
}

/** 例外里已不在媒体库的专辑随手清掉。`known` 是整份清单的专辑键，不是过滤后看得见的那些。 */
export function withoutGoneAlbums(
  value: CollapsedSections,
  known: ReadonlySet<string>,
): CollapsedSections {
  const albums = value.listAlbums;
  if (!albums || albums.except.every((key) => known.has(key))) return value;
  return {
    ...value,
    listAlbums: { ...albums, except: albums.except.filter((key) => known.has(key)) },
  };
}

/** 页头「展开 / 折叠」键的四项。 */
export type ListBatch = 'expandAll' | 'onlySections' | 'collapseAlbums' | 'collapseAll';

export function applyListBatch(
  value: CollapsedSections,
  dimension: SectionDimension,
  sections: readonly ListSectionKeys[],
  batch: ListBatch,
): CollapsedSections {
  const keys = sections.map((section) => section.key);
  switch (batch) {
    case 'expandAll':
      return withAllAlbums(withSections(value, dimension, keys, false), false);
    case 'onlySections':
      return withAllAlbums(withSections(value, dimension, keys, false), true);
    case 'collapseAlbums':
      return withAllAlbums(value, true);
    case 'collapseAll':
      return withAllAlbums(withSections(value, dimension, keys, true), true);
  }
}

/** 节头右键菜单里只作用于这一节的三项。 */
export type SectionBatch = 'expandAlbums' | 'collapseAlbums' | 'only';

export function applySectionBatch(
  value: CollapsedSections,
  dimension: SectionDimension,
  sections: readonly ListSectionKeys[],
  key: string | null,
  batch: SectionBatch,
): CollapsedSections {
  const section = sections.find((candidate) => candidate.key === key);
  if (!section) return value;
  switch (batch) {
    case 'expandAlbums':
      return withAlbums(withSections(value, dimension, [key], false), section.albums, false);
    case 'collapseAlbums':
      return withAlbums(value, section.albums, true);
    case 'only': {
      const others = sections.filter((other) => other.key !== key).map((other) => other.key);
      return withSections(withSections(value, dimension, others, true), dimension, [key], false);
    }
  }
}
