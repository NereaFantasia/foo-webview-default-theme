import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useAtomValueRawSync } from 'jotai/react';
import { STANDARD_GRID_SHAPE } from '../cover-tile/CoverGrid.tsx';
import { translateAtom } from '../../i18n/locale.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { RAIL_GAP, RAIL_PEEK, railLayout, type RailShape } from './homeRail.ts';
import styles from './HomeRail.module.css';

/** 一排的翻页状态：是否已滚到两头、第几页与共几页，与翻一页的动作。横排行交给所在的行，由标题行画翻页组 */
export interface RailPager extends RailEdge {
  page(direction: 1 | -1): void;
}

/** 横排行所在的行提供：横排行把翻页状态交上去，标题行据此画翻页组；没有标题行时为 null */
export const RailPagerContext = createContext<((pager: RailPager | null) => void) | null>(null);

/** 封面图块（专辑、歌单）在横排行里的尺寸 */
export const TILE_SHAPE: RailShape = { min: 140, max: 220, per: 5 };
// 封面图块按这两个变量排封面与文字：边长跟着横排行的条目宽度走
export const TILE_VARS = {
  '--tile-size': 'var(--rail-item)',
  '--tile-line': `${STANDARD_GRID_SHAPE.lineHeight}px`,
} as CSSProperties;

const STOPS = 'button:not(:disabled), a[href]';

/**
 * 横幅两侧的箭头：两边夹角约 120°，比 Fluent 的 Chevron（约 90°）张得开，又高又窄；Fluent 图标里没有这种张角，
 * 自己画。视口 16 × 32，尺寸由样式给
 */
function WideChevron({ direction }: { readonly direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 16 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d={direction === 'left' ? 'M11 5L5 16L11 27' : 'M5 5L11 16L5 27'} />
    </svg>
  );
}

/** 一排滚到了哪里：是否已到两头（到头的一侧翻页键置灰，两侧圆键则不出），第几页与共几页（从 1 数） */
export interface RailEdge {
  readonly start: boolean;
  readonly end: boolean;
  readonly index: number;
  readonly total: number;
}

const UNMEASURED: RailEdge = { start: true, end: true, index: 1, total: 1 };

/**
 * 量一排滚到了哪里。一页是翻一次的距离 `step`：最后一页是滚到底的那一屏，不足一整页也算一页；
 * 停在两页之间时按离得近的那一页算，滚到底时算最后一页
 */
function railEdge(track: HTMLElement, step: number, old: RailEdge): RailEdge {
  const room = Math.max(0, track.scrollWidth - track.clientWidth);
  const start = track.scrollLeft < 1;
  const end = track.scrollLeft >= room - 1;
  const total = room > 1 && step > 0 ? Math.ceil((room - 1) / step) + 1 : 1;
  const index = end ? total : Math.min(total, Math.round(track.scrollLeft / step) + 1);
  return old.start === start && old.end === end && old.index === index && old.total === total
    ? old
    : { start, end, index, total };
}

export interface HomeRailProps<T> {
  /** 页面快照按它记这一排翻到了哪里，同一页里唯一 */
  readonly id: string;
  readonly label: string;
  /** 所在行的宽度，像素；各行同宽，由页面量一次传下来 */
  readonly rowWidth: number;
  readonly shape: RailShape;
  readonly items: readonly T[];
  keyOf(item: NoInfer<T>): string;
  render(item: T): ReactNode;
  /**
   * 翻页键压在这一排两侧的圆键，悬停时淡入；不给时翻页组画在所在行的标题行右端。没有标题行的横幅用它
   * `at` 是圆键的中线离这一排顶边多远（像素），按条目宽度算
   */
  readonly sideArrows?: { readonly at: (width: number) => number };
}

/**
 * 横向的一排条目：宽度随行宽在上下限之间缩放，放不下时右边露出下一张的一角，可横向滚动与翻页
 * 条目宽度经 `--rail-item` 交给条目里的内容；左右方向键在条目之间移动焦点，焦点落在条目里时不再交给全局快捷键
 * 翻页状态交给所在的行画在标题行；给了 `sideArrows` 时改画在这一排两侧
 */
export function HomeRail<T>({
  id,
  label,
  rowWidth,
  shape,
  items,
  keyOf,
  render,
  sideArrows,
}: HomeRailProps<T>) {
  const t = useAtomValueRawSync(translateAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<RailEdge>(UNMEASURED);
  const layout = railLayout(rowWidth, items.length, shape, RAIL_GAP);
  const step = rowWidth - RAIL_PEEK;
  const measure = () => {
    const box = track.current;
    if (box) setEdge((old) => railEdge(box, step, old));
  };
  useLayoutEffect(() => {
    const box = track.current;
    if (box) setEdge((old) => railEdge(box, step, old));
  }, [step, items.length]);
  const page = useCallback(
    (direction: 1 | -1) =>
      track.current?.scrollBy({
        left: direction * step,
        behavior: reduced ? 'auto' : 'smooth',
      }),
    [step, reduced],
  );
  const publish = useContext(RailPagerContext);
  useLayoutEffect(() => {
    if (sideArrows || !publish) return;
    // 按公式要翻页、实际却刚好放下（两头都到了）时不出：两个键都置灰的翻页组没有用
    const scrolls = layout.paged && !(edge.start && edge.end);
    publish(scrolls ? { ...edge, page } : null);
    return () => publish(null);
  }, [publish, sideArrows, layout.paged, edge, page]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const active = document.activeElement;
    const cells = [...event.currentTarget.children];
    const at = cells.findIndex((cell) => cell.contains(active));
    const from = cells[at];
    if (!from || !(active instanceof HTMLElement)) return;
    event.preventDefault();
    const next = cells[at + (event.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    const stops = [...next.querySelectorAll<HTMLElement>(STOPS)];
    const index = [...from.querySelectorAll<HTMLElement>(STOPS)].indexOf(active);
    stops[Math.min(Math.max(index, 0), stops.length - 1)]?.focus();
  };
  const vars: CSSProperties & Record<`--${string}`, string> = {
    '--rail-item': `${layout.width}px`,
    '--rail-gap': `${RAIL_GAP}px`,
    ...(sideArrows ? { '--rail-arrow': `${sideArrows.at(layout.width)}px` } : {}),
  };
  const arrows = sideArrows && layout.paged;
  return (
    <div className={styles.rail} style={vars}>
      <div
        ref={track}
        role="list"
        aria-label={label}
        className={styles.track}
        data-home-rail={id}
        onScroll={measure}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => (
          <div key={keyOf(item)} role="listitem" className={styles.cell}>
            {render(item)}
          </div>
        ))}
      </div>
      {arrows && !edge.start && (
        <button
          type="button"
          className={`${styles.arrow} ${styles.prev}`}
          aria-label={t('home.previousPage')}
          tabIndex={-1}
          onClick={() => page(-1)}
        >
          <WideChevron direction="left" />
        </button>
      )}
      {arrows && !edge.end && (
        <button
          type="button"
          className={`${styles.arrow} ${styles.next}`}
          aria-label={t('home.nextPage')}
          tabIndex={-1}
          onClick={() => page(1)}
        >
          <WideChevron direction="right" />
        </button>
      )}
    </div>
  );
}

/** 一排翻到了第几张：左边界上的那一张的序号 */
export function railIndex(track: HTMLElement): number {
  const first = track.children[0];
  const second = track.children[1];
  if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return 0;
  const pitch = second.offsetLeft - first.offsetLeft;
  return pitch > 0 ? Math.round(track.scrollLeft / pitch) : 0;
}

/** 把一排翻回第 `index` 张，不带动画 */
export function scrollRailTo(track: HTMLElement, index: number): void {
  const first = track.children[0];
  const target = track.children[index];
  if (first instanceof HTMLElement && target instanceof HTMLElement)
    track.scrollLeft = target.offsetLeft - first.offsetLeft;
}
