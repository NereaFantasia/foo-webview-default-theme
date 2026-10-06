import type { GridItem, GridRowItem } from './albumGridLayout.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../../host/libraryContract.ts';

// 封面墙的下拉：单击一张封面，在它那一行下面插一条下拉，列出这张专辑的曲目。下拉是条目流里的一种
// 条目，插在被点那一行后面，不改列数算法：列数一变行重新切，下拉跟着那张专辑挂到它新的所在行后面。
// 纯函数，入参一律不改。

/**
 * 下拉面板的几何，CSS 像素。头、尾两段的高由样式照这里的值定死（专辑名一行、艺术家一行、尾注一行
 * 与各自的留白都取 token，加起来正好是这两个数）。面板高固定，不随首数变：头、八行曲目与尾之和。
 */
export const DROPDOWN_METRICS = {
  /** 曲目行高。 */
  rowHeight: 26,
  /** 顶边留白、专辑名、专辑艺术家与到曲目之间的留白。 */
  head: 84,
  /** 曲目到尾注的留白、尾注一行与底边留白。 */
  foot: 48,
  /** 首数超过它就分两栏。 */
  twoColumnsOver: 8,
  /** 曲目区最多露出这么多行，与一栏的上限相同；首数再多，曲目区自己滚动，面板不变高。 */
  maxLines: 8,
  /**
   * 封面框的边长，也是面板的高：正好是头、八行曲目与尾之和。封面框铺满面板的高，宽也是它（面板窄时让到
   * 面板宽的四成）。取图按它的档位，每张专辑的下拉封面一样大、取的是同一档。
   */
  cover: 340,
} as const;

/** 窄面板里封面最多占面板宽的这么多，右边还放得下两栏曲目。 */
const COVER_SHARE = 0.4;

/** 这么宽的面板里封面框的宽，CSS 像素，取整；框的高恒为面板高。 */
export function dropdownCoverSize(panelWidth: number): number {
  return Math.max(0, Math.min(DROPDOWN_METRICS.cover, Math.round(panelWidth * COVER_SHARE)));
}

function countOf(trackCount: number): number {
  return Math.max(0, Math.floor(trackCount));
}

/** 曲目区分几栏：超过 `twoColumnsOver` 首两栏，否则一栏。 */
export function trackColumns(trackCount: number): 1 | 2 {
  return countOf(trackCount) > DROPDOWN_METRICS.twoColumnsOver ? 2 : 1;
}

/**
 * 曲目区露出几行：一栏时一首一行；两栏时左栏先排满（多出的一首在左），至多 `maxLines` 行，再多的
 * 在曲目区里滚动。
 */
export function trackLines(trackCount: number): number {
  const count = countOf(trackCount);
  if (trackColumns(count) === 1) return count;
  return Math.min(DROPDOWN_METRICS.maxLines, Math.ceil(count / 2));
}

/**
 * 第 `index` 首（从 0 起）落在曲目区的哪一格，行与栏都从 1 起，直接作 CSS 网格线。两栏时按段排：一段
 * 是露得出的 `2 × maxLines` 首，段内先排满左栏再排右栏，下一段接在下面；最后一段不满时两栏对半，
 * 左栏多一首。所以首数不超过一段时整张一眼看全，再多时往下滚一段，读的顺序仍是左栏、右栏、下一段。
 */
export function trackCell(index: number, trackCount: number): { row: number; column: 1 | 2 } {
  const count = countOf(trackCount);
  if (trackColumns(count) === 1) return { row: index + 1, column: 1 };
  const { maxLines } = DROPDOWN_METRICS;
  const page = Math.floor(index / (2 * maxLines));
  const within = index - page * 2 * maxLines;
  const lines = Math.ceil(Math.min(2 * maxLines, count - page * 2 * maxLines) / 2);
  const left = within < lines;
  return { row: page * maxLines + (left ? within : within - lines) + 1, column: left ? 1 : 2 };
}

/**
 * 面板的高：头、露出的曲目行与尾，不矮于封面边长。露出的至多 `maxLines` 行，头、这几行与尾正好是封面边长，
 * 所以不论首数都是这个高；单击那一刻就知道展开动画要长到多高，曲目到了也不改高。
 */
export function dropdownPanelHeight(trackCount: number): number {
  const { head, foot, rowHeight, cover } = DROPDOWN_METRICS;
  return Math.max(cover, head + trackLines(trackCount) * rowHeight + foot);
}

/** 条目流里的一条下拉。 */
export interface GridDropdownItem {
  readonly kind: 'dropdown';
  /** 这一条下拉的身份：同一行里换一张专辑不换，渲染键与动画都按它认。 */
  readonly id: number;
  readonly album: Album;
  readonly sectionKey: string | null;
  /** 被点那张在它那一行里是第几块，箭头指着它。 */
  readonly column: number;
  /** 在条目流里占的高：面板高加一个行间距，与图块行底下留的行间距一样。 */
  readonly size: number;
}

/** 要插的一条：哪张专辑（在哪一节里被点的）、面板多高。 */
export interface DropdownPlacement {
  readonly id: number;
  readonly album: Album;
  readonly sectionKey: string | null;
  readonly panel: number;
}

/** 专辑所在的行：先找 `section` 那一节的，没有再取第一块所在的行（按艺术家分节时一张在几节里各一块）。 */
export function rowHolding(
  items: readonly GridItem[],
  key: AlbumKey,
  section: string | null,
): { index: number; column: number; row: GridRowItem } | undefined {
  let fallback: { index: number; column: number; row: GridRowItem } | undefined;
  for (const [index, item] of items.entries()) {
    if (item.kind !== 'row') continue;
    const column = item.albums.findIndex((album) => albumKeyOf(album) === key);
    if (column < 0) continue;
    const hit = { index, column, row: item };
    if (item.sectionKey === section) return hit;
    fallback ??= hit;
  }
  return fallback;
}

/**
 * 把下拉插进条目流，每条插在它那张专辑所在行的后面。换到别的行时新旧两条同时在流里（旧的在收、新的
 * 在展），所以入参是个列表，排在前面的优先：同一行里至多挂一条，后来的那条不插。专辑被折叠、被过滤掉
 * 或不在清单里时那一条不插。`gap` 是行间距。
 */
export function withDropdowns(
  items: readonly GridItem[],
  placements: readonly DropdownPlacement[],
  gap: number,
): GridItem[] {
  if (placements.length === 0) return [...items];
  const after = new Map<number, GridDropdownItem>();
  for (const placement of placements) {
    const hit = rowHolding(items, albumKeyOf(placement.album), placement.sectionKey);
    if (!hit || after.has(hit.index)) continue;
    after.set(hit.index, {
      kind: 'dropdown',
      id: placement.id,
      album: placement.album,
      sectionKey: hit.row.sectionKey,
      column: hit.column,
      size: placement.panel + gap,
    });
  }
  return items.flatMap((item, index) => {
    const dropdown = after.get(index);
    return dropdown ? [item, dropdown] : [item];
  });
}

/** 一个条目在条目流里占多高：图块行与节头按显示样式的几何，下拉按自己带的高。 */
export function flowItemSize(item: GridItem, rowHeight: number, headerHeight: number): number {
  if (item.kind === 'dropdown') return item.size;
  return item.kind === 'header' ? headerHeight : rowHeight;
}

/** 条目在条目流里各自的上沿，末尾多一项是总高。 */
export function itemTops(items: readonly GridItem[], sizeOf: (item: GridItem) => number): number[] {
  const tops = [0];
  let top = 0;
  for (const item of items) {
    top += sizeOf(item);
    tops.push(top);
  }
  return tops;
}

/** 条目流的几何：图块行高、节头高与行间距，CSS 像素。 */
export interface FlowMetrics {
  readonly rowHeight: number;
  readonly headerHeight: number;
  readonly gap: number;
}

/** 插上这几条下拉之后的条目流与各条目的上沿（末尾多一项是总高）。 */
export function flowWith(
  items: readonly GridItem[],
  placements: readonly DropdownPlacement[],
  metrics: FlowMetrics,
): { readonly flow: GridItem[]; readonly tops: number[] } {
  const flow = withDropdowns(items, placements, metrics.gap);
  const tops = itemTops(flow, (item) =>
    flowItemSize(item, metrics.rowHeight, metrics.headerHeight),
  );
  return { flow, tops };
}

/**
 * 下拉 `id` 在条目流里的位置：它那一行的上沿、它自己的上沿与下一个条目的上沿（含底下的行间距）；
 * 没插进去时答 undefined。
 */
export function dropdownSpan(
  flow: readonly GridItem[],
  tops: readonly number[],
  id: number,
): { readonly rowTop: number; readonly top: number; readonly next: number } | undefined {
  const at = flow.findIndex((item) => item.kind === 'dropdown' && item.id === id);
  if (at < 1) return undefined;
  return { rowTop: tops[at - 1] ?? 0, top: tops[at] ?? 0, next: tops[at + 1] ?? 0 };
}

export interface ScrollTargetInput {
  readonly scrollTop: number;
  /** 视口高。 */
  readonly viewport: number;
  /** 被点那一行的上沿与下拉面板的下沿，按动画结束后的条目流算。 */
  readonly rowTop: number;
  readonly dropdownBottom: number;
  /** 行间距：下拉底边离视口底边至少留这么多。 */
  readonly gap: number;
  /** 动画结束后能滚到的最低处。 */
  readonly maxScroll: number;
}

/**
 * 展开时视口要滚到哪。被点那一行与下拉都完整落在视口里、下拉底边离视口底边还留一个行间距时不滚；
 * 否则滚到下拉底边（连同那个行间距）贴视口底边，但被点那一行的上沿不能滚出视口，两者冲突（行加下拉
 * 比视口还高）时以行顶贴视口顶为准。往上滚只滚到行顶露出来为止。
 */
export function scrollTargetFor(input: ScrollTargetInput): number {
  const { scrollTop, viewport, rowTop, dropdownBottom, gap, maxScroll } = input;
  const fits = rowTop >= scrollTop && dropdownBottom + gap <= scrollTop + viewport;
  if (fits) return scrollTop;
  const bottomAligned = dropdownBottom + gap - viewport;
  const target = Math.min(rowTop, Math.max(scrollTop, bottomAligned));
  return Math.max(0, Math.min(Math.max(0, maxScroll), target));
}

/** 算下拉动画的滚动目标要的几何：此刻的条目流（不含下拉）与滚动容器。 */
export interface FoldGeometry extends FlowMetrics {
  readonly items: readonly GridItem[];
  readonly scrollTop: number;
  readonly viewport: number;
  /** 滚动容器上下内边距之和：能滚到的最低处是总高加它再减视口高。 */
  readonly padding: number;
}

/**
 * 下拉动完之后视口该在哪，按动完的条目流（只插还开着的 `placements`）算。给了 `reveal`（展开或改高
 * 的那条）就照 `scrollTargetFor` 让它那一行与面板露出来，它不在条目流里答 undefined；不给是只有收起，
 * 内容变短时视口被迫上移到能滚到的最低处，否则不动。
 */
export function foldScrollTarget(
  geometry: FoldGeometry,
  placements: readonly DropdownPlacement[],
  reveal: { readonly id: number; readonly panel: number } | null,
): number | undefined {
  const { flow, tops } = flowWith(geometry.items, placements, geometry);
  const maxScroll = (tops[tops.length - 1] ?? 0) + geometry.padding - geometry.viewport;
  const { scrollTop, viewport, gap } = geometry;
  if (!reveal) return Math.max(0, Math.min(scrollTop, maxScroll));
  const span = dropdownSpan(flow, tops, reveal.id);
  if (!span) return undefined;
  const dropdownBottom = span.top + reveal.panel;
  return scrollTargetFor({
    scrollTop,
    viewport,
    rowTop: span.rowTop,
    dropdownBottom,
    gap,
    maxScroll,
  });
}
