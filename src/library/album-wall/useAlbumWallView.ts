import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { focusLost } from '../../kit/focusLost.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { rowHolding } from './albumDropdown.ts';
import type { GridItem } from './albumGridLayout.ts';
import { albumKeyOf, type Album } from '../../host/libraryContract.ts';
import { createScrollRestore } from '../../kit/scrollRestore.ts';
import type { WallFocus } from './useAlbumWallInput.ts';

/**
 * 封面墙离开时记下、回来时交还的样子：滚到哪、焦点在哪一块、下拉开着哪一张（在哪一节里的那一块）。
 * 选中不在里面，回来不恢复。
 */
export interface WallView {
  readonly scrollTop: number;
  readonly focus: WallFocus | null;
  readonly dropdown: WallFocus | null;
}

/** 下拉那一侧要的：此刻开着哪一张，与不播动画、不自动滚地直接开到位。 */
export interface WallDropdownView {
  current(): { readonly album: Album; readonly sectionKey: string | null } | null;
  restore(album: Album, sectionKey: string | null): void;
}

const WALL_SLOT = createSnapshotSlot<WallView>();

/** 这几种输入是用户在网格上动了；捕获阶段听，节头按钮与图块上的也算。 */
const USER_INPUT = ['keydown', 'pointerdown', 'wheel'] as const;
const LISTEN: AddEventListenerOptions = { capture: true, passive: true };

export interface AlbumWallViewOptions {
  readonly scroller: RefObject<HTMLDivElement | null>;
  readonly items: readonly GridItem[];
  readonly focus: WallFocus | null;
  readonly setFocus: (focus: WallFocus | null) => void;
  /**
   * 条目流排定了：清单到了、宽度量到了、过滤词的曲目级命中也并上了（或者确实无匹配）。交还的样子
   * 这时才落，早落的话滚动按一份还会再变的条目流算。
   */
  readonly settled: boolean;
  /**
   * 页面替封面墙记着的一份：切到列表形态时封面墙卸掉，切回来按它恢复。比历史快照新，两者都有时用它。
   */
  readonly memory: { current: WallView | null };
  readonly dropdown: WallDropdownView;
}

/**
 * 封面墙的快照：离开这条历史记录、或切到别的形态时记下，回来时交还。快照从挂上起就登记，离开时总能记下
 * 此刻的样子，连同过滤无匹配时的空墙：不记的话，槽里留着更早的一份，回来清掉过滤词就跳回那里。
 * 交还的那份先收着，等条目流排定再落（`settled`）；还没落就又离开时原样记回去。滚动落下后还可能要等
 * 条目流再变一次（见 `createScrollRestore`），用户在网格上按键、按下指针或转滚轮，挂着的就作罢。
 */
export function useAlbumWallView(options: AlbumWallViewOptions): void {
  const { scroller, items, setFocus, settled, memory, dropdown } = options;
  const focusNow = useRef(options.focus);
  useLayoutEffect(() => {
    focusNow.current = options.focus;
  });
  const [restore] = useState(() => createScrollRestore());
  /** 交还了、还没落下的一份。 */
  const waiting = useRef<WallView | null>(null);
  /** 连同下拉一起交还时，滚动等下拉插进条目流的那次提交再落：落在没有下拉的条目流上会差一截。 */
  const deferred = useRef<{ top: number; before: readonly GridItem[] } | null>(null);
  const capture = (): WallView => {
    if (waiting.current) return waiting.current;
    const open = dropdown.current();
    return {
      scrollTop: deferred.current?.top ?? scroller.current?.scrollTop ?? 0,
      focus: focusNow.current,
      dropdown: open && { key: albumKeyOf(open.album), section: open.sectionKey },
    };
  };

  const latest = useRef({ capture });
  useLayoutEffect(() => {
    latest.current = { capture };
  });

  usePageSnapshot(
    WALL_SLOT,
    {
      capture,
      restore: (view) => {
        waiting.current = view;
      },
    },
    true,
  );

  // 这一段在快照登记之后：切形态回来时页面记着的那份更新，覆盖历史交还的旧快照。
  useLayoutEffect(() => {
    if (!memory.current) return;
    waiting.current = memory.current;
    memory.current = null;
  }, [memory]);

  // 卸掉时记下最后的样子。布局阶段的清理先于子元素的 ref 解绑，滚动容器此时还读得到。开发时 StrictMode
  // 在挂上之后立即清理一次，那时交还的一份还收着没落，记下的就是它，不会被空样子盖掉。
  useLayoutEffect(() => {
    const hooks = latest;
    return () => {
      memory.current = hooks.current.capture();
    };
  }, [memory]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const cancel = () => restore.cancel();
    for (const type of USER_INPUT) element.addEventListener(type, cancel, LISTEN);
    return () => {
      for (const type of USER_INPUT) element.removeEventListener(type, cancel, LISTEN);
    };
  }, [scroller, restore]);

  // 每次提交都看：交还可能晚于排定（历史在挂上时交还，宽度与命中随后才到），也可能早于它。
  useLayoutEffect(() => {
    const later = deferred.current;
    if (later && later.before !== items) {
      deferred.current = null;
      restore.hold(later.top, items);
    }
    const view = waiting.current;
    if (settled && view) {
      waiting.current = null;
      setFocus(view.focus);
      // 从详情页后退回来时 DOM 焦点随旧页面卸掉了，交还给网格，键盘接着从那一块走。
      if (view.focus && focusLost()) scroller.current?.focus({ preventScroll: true });
      const open = view.dropdown;
      const hit = open && rowHolding(items, open.key, open.section);
      const album = hit?.row.albums[hit.column];
      if (open && album) {
        dropdown.restore(album, open.section);
        deferred.current = { top: view.scrollTop, before: items };
      } else {
        restore.hold(view.scrollTop, items);
      }
    }
    const element = scroller.current;
    if (element) restore.commit(element, items);
  });
}
