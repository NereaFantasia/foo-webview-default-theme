import { albumArtistOf, albumYearOf, type Album } from '../../host/libraryContract.ts';

// 筛选条的三列：流派、年代、专辑艺术家。取值与过滤都按专辑行上的字段，不问宿主：
// 流派比 `genre`（首曲的首个 genre），年代由 `year` 归出，专辑艺术家比 `albumArtistOf`。
// 取值因此恰是筛得出专辑的那些，每项的数目就是勾上它能筛出几张。
// 列内多选是 OR，跨列 AND；一列一个都没勾就是这一列不设条件。

export const FACET_FIELDS = ['genre', 'decade', 'albumArtist'] as const;
export type FacetField = (typeof FACET_FIELDS)[number];

export interface FacetValue {
  readonly name: string;
  /** 带这个值的专辑张数。 */
  readonly albumCount: number;
}

export type FacetOptions = Readonly<Record<FacetField, readonly FacetValue[]>>;
export type FacetSelection = Readonly<Record<FacetField, ReadonlySet<string>>>;

/** 每列最多列多少项。按张数取前面的，冷门的值仍能从过滤框打字命中。 */
export const FACET_LIMIT = 200;

export const EMPTY_FACET_SELECTION: FacetSelection = {
  genre: new Set(),
  decade: new Set(),
  albumArtist: new Set(),
};

/** `2016` 归 `2010s`；没有年份的不归任何年代。 */
export function decadeOf(year: string): string | null {
  return /^\d{4}$/.test(year) ? `${year.slice(0, 3)}0s` : null;
}

function valueOf(album: Album, field: FacetField): string | null {
  switch (field) {
    case 'genre':
      return album.genre || null;
    case 'decade':
      return decadeOf(albumYearOf(album));
    case 'albumArtist':
      return albumArtistOf(album) || null;
  }
}

function countBy(albums: readonly Album[], field: FacetField): Map<string, number> {
  const counts = new Map<string, number>();
  for (const album of albums) {
    const value = valueOf(album, field);
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 三列的取值：流派与专辑艺术家按张数多的在前、同数按名字，年代新的在前；每列最多 `FACET_LIMIT` 项。 */
export function facetOptionsOf(albums: readonly Album[]): FacetOptions {
  const byCount = (field: FacetField): FacetValue[] =>
    [...countBy(albums, field)]
      .map(([name, albumCount]) => ({ name, albumCount }))
      .sort((a, b) => b.albumCount - a.albumCount || collator.compare(a.name, b.name))
      .slice(0, FACET_LIMIT);
  const decades = [...countBy(albums, 'decade')]
    .map(([name, albumCount]) => ({ name, albumCount }))
    .sort((a, b) => b.name.localeCompare(a.name));
  return { genre: byCount('genre'), decade: decades, albumArtist: byCount('albumArtist') };
}

export function hasFacetSelection(selection: FacetSelection): boolean {
  return FACET_FIELDS.some((field) => selection[field].size > 0);
}

export function facetSelectionCount(selection: FacetSelection): number {
  return FACET_FIELDS.reduce((count, field) => count + selection[field].size, 0);
}

/** 按勾选筛专辑；没设条件时原样复制一份。 */
export function applyFacets(albums: readonly Album[], selection: FacetSelection): Album[] {
  const active = FACET_FIELDS.filter((field) => selection[field].size > 0);
  if (active.length === 0) return [...albums];
  return albums.filter((album) =>
    active.every((field) => {
      const value = valueOf(album, field);
      return value !== null && selection[field].has(value);
    }),
  );
}

/** 勾上或取消一个值，返回新的勾选；原来的不改。 */
export function toggleFacet(
  selection: FacetSelection,
  field: FacetField,
  name: string,
): FacetSelection {
  const next = new Set(selection[field]);
  if (!next.delete(name)) next.add(name);
  return { ...selection, [field]: next };
}

/**
 * 库变了之后，勾选里不在取值清单上的值剔掉：库里已经没有专辑带着它，或它掉出了这一列的前
 * `FACET_LIMIT` 项。留着它会筛出 0 张，清单里又没有这一项可以取消。不改成把它留在清单里显示：
 * 清单只列筛得出专辑的值，每项的数目就是勾上能筛出几张，混进一项 0 张的就不是这个口径了。
 * 没有要剔的时原样答回，调用方可按引用判断。
 */
export function pruneFacetSelection(
  selection: FacetSelection,
  options: FacetOptions,
): FacetSelection {
  let changed = false;
  const next = { ...selection };
  for (const field of FACET_FIELDS) {
    const offered = new Set(options[field].map((value) => value.name));
    const kept = new Set([...selection[field]].filter((name) => offered.has(name)));
    if (kept.size !== selection[field].size) {
      next[field] = kept;
      changed = true;
    }
  }
  return changed ? next : selection;
}
