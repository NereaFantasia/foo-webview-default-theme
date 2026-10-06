import { useAtomValueRawSync, useStore } from 'jotai/react';
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useCommand } from '../../../nav/useCommand.ts';
import { reducedMotionAtom } from '../../../motion/reducedMotion.ts';
import { rowHolding } from '../albumDropdown.ts';
import { dropdownTracksAtom } from './albumDropdownTracks.ts';
import type { GridItem } from '../albumGridLayout.ts';
import { browserPrefsAtom } from '../../albums/browserPrefs.ts';
import { albumKeyOf } from '../../../host/libraryContract.ts';
import type { FoldFrame } from './foldClock.ts';
import type { AlbumWallLayout } from '../useAlbumWallLayout.ts';
import { WallFold, type FoldSnapshot } from './wallFold.ts';
import { useService } from '../../../kit/useService.ts';
import { albumsKey } from '../../albumServices.ts';

/** 同时在动的下拉至多几条各自带一组平移量；再多的并进最后一组（连点几行才会出现，平移略有偏差）。 */
export const FOLD_GROUPS = 3;

/** 这几种输入是用户自己在滚或在动：自动滚动就此停下。 */
const USER_INPUT = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;
const LISTEN: AddEventListenerOptions = { capture: true, passive: true };

export interface AlbumDropdownOptions {
  readonly scroller: RefObject<HTMLDivElement | null>;
  /** 不含下拉的几何与条目流。 */
  readonly layout: AlbumWallLayout;
  /** 条目流排定了：这时专辑不在流里才算被过滤或折叠掉。 */
  readonly settled: boolean;
}

export interface AlbumDropdownModel {
  readonly fold: WallFold;
  /** 结构不变时是同一个对象。 */
  readonly snapshot: FoldSnapshot;
  /** 挂到图块行的容器上：平移量写成它上面的 CSS 变量。 */
  readonly rows: RefObject<HTMLDivElement | null>;
  /** 此刻露出的高，按下拉的身份；引用不变。 */
  readonly visibleOf: (id: number) => number;
  /** ✕：焦点交还网格再收起，收完卸掉时焦点不会掉到页面上。引用不变。 */
  readonly close: () => void;
  /** 网格上的 Tab：有开着的下拉就把焦点送进它的曲目（曲目没到时送到播放键），答处理了没有。 */
  readonly tabInto: (event: KeyboardEvent<HTMLElement>) => boolean;
}

/**
 * 条目流里每个条目跟哪一组平移：它上面有几条下拉，0 是不动。按条目流建一次，逐个图块查。
 */
export function foldGroups(items: readonly GridItem[]): (index: number) => number {
  const dropdowns = items.flatMap((item, index) => (item.kind === 'dropdown' ? [index] : []));
  return (index) => Math.min(dropdowns.filter((at) => at < index).length, FOLD_GROUPS);
}

/** 把一帧写进 DOM：平移量挂在行容器上，露出的高挂在各条下拉上；没在动的组归零。 */
function paintFold(rows: HTMLElement | null, frame: FoldFrame): void {
  if (!rows) return;
  for (let group = 1; group <= FOLD_GROUPS; group += 1) {
    const shift = frame.shifts[Math.min(group, frame.shifts.length) - 1] ?? 0;
    rows.style.setProperty(`--fold-shift-${group}`, `${shift}px`);
  }
  for (const [id, visible] of frame.visible) {
    const slot = rows.querySelector<HTMLElement>(`[data-fold-slot="${id}"]`);
    slot?.style.setProperty('--fold-visible', `${visible}px`);
  }
}

/**
 * 封面墙下拉的开合（`WallFold`）接到 React：几何取最近一次渲染的，每次提交后让它按新结构接着画，
 * 结构一变就重画。这张被过滤或折叠掉、换了排序或分节依据时当场撤掉；用户自己滚了就不再自动滚。
 */
export function useAlbumDropdown(options: AlbumDropdownOptions): AlbumDropdownModel {
  const { scroller, layout, settled } = options;
  const albums = useService(albumsKey);
  const store = useStore();
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const { sort, dimension } = useAtomValueRawSync(browserPrefsAtom);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const rows = useRef<HTMLDivElement>(null);
  const latest = useRef({ layout, reduced });
  useLayoutEffect(() => {
    latest.current = { layout, reduced };
  });
  const [fold] = useState(
    () =>
      new WallFold({
        geometry: () => {
          const { items, rowHeight, metrics } = latest.current.layout;
          const element = scroller.current;
          const style = element ? getComputedStyle(element) : null;
          return {
            items,
            rowHeight,
            headerHeight: metrics.headerHeight,
            gap: metrics.gap,
            scrollTop: element?.scrollTop ?? 0,
            viewport: element?.clientHeight ?? 0,
            padding: style ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 0,
          };
        },
        scrollTop: () => scroller.current?.scrollTop ?? 0,
        scrollTo: (top) => {
          if (scroller.current) scroller.current.scrollTop = top;
        },
        paint: (frame) => paintFold(rows.current, frame),
        changed: redraw,
        load: async (album) => (await albums.dropdown.load(album))?.length ?? null,
        countOf: (album) =>
          store.get(dropdownTracksAtom).tracks.get(albumKeyOf(album))?.length ?? album.trackCount,
        reduced: () => latest.current.reduced,
        now: () => performance.now(),
        frame: (callback) => {
          const handle = requestAnimationFrame(callback);
          return () => cancelAnimationFrame(handle);
        },
      }),
  );
  useEffect(() => () => fold.pause(), [fold]);
  const [handlers] = useState(() => ({
    visibleOf: (id: number) => fold.visibleOf(id),
    close: () => {
      scroller.current?.focus({ preventScroll: true });
      fold.close();
    },
    tabInto: (event: KeyboardEvent<HTMLElement>) => {
      const live = fold.current();
      if (event.key !== 'Tab' || event.shiftKey || event.target !== event.currentTarget || !live) {
        return false;
      }
      const id = fold.snapshot().views.find((view) => !view.closing)?.id;
      const panel = rows.current?.querySelector(`[data-fold-slot="${id}"]`);
      // 换内容的途中新旧两份叠着，新的一份排在后面。
      const lists = panel?.querySelectorAll<HTMLElement>('[data-dropdown-tracks]');
      const target = lists?.[lists.length - 1] ?? panel?.querySelector<HTMLElement>('button');
      if (!target) return false;
      event.preventDefault();
      target.focus({ preventScroll: true });
      return true;
    },
  }));

  // Esc 按浮层算：焦点在网格或下拉里时收起开着的那条。
  useCommand({
    id: 'album.dropdown.close',
    layer: 'overlay',
    keys: [{ key: 'Escape' }],
    enabled: () => fold.current() !== null && !!scroller.current?.contains(document.activeElement),
    run: handlers.close,
  });
  useLayoutEffect(() => fold.committed());

  const current = fold.current();
  useLayoutEffect(() => {
    if (!settled || !current) return;
    if (!rowHolding(layout.items, albumKeyOf(current.album), current.sectionKey)) fold.dismiss();
  });
  const order = useRef({ sort, dimension });
  useLayoutEffect(() => {
    if (order.current.sort !== sort || order.current.dimension !== dimension) fold.dismiss();
    order.current = { sort, dimension };
  }, [fold, sort, dimension]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const stop = () => fold.userScrolled();
    for (const type of USER_INPUT) element.addEventListener(type, stop, LISTEN);
    return () => {
      for (const type of USER_INPUT) element.removeEventListener(type, stop, LISTEN);
    };
  }, [scroller, fold]);

  return { fold, snapshot: fold.snapshot(), rows, ...handlers };
}
