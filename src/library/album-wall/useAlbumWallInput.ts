import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { TileHandlers } from './AlbumTile.tsx';
import { createAlbumGridInput, type AlbumGridInput } from './albumGridInput.ts';
import type { GridPosition } from './albumGridKeys.ts';
import { gridIndexOf, readingPositionOf, stepTileSize, type GridItem } from './albumGridLayout.ts';
import type { MenuPoint } from '../albumMenu.ts';
import { browserPrefsAtom, TILE_SIZE_STEP } from '../albums/browserPrefs.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../../host/libraryContract.ts';
import type { TypeSearch } from '../../kit/typeSearch.ts';
import type { AlbumWallLayout } from './useAlbumWallLayout.ts';
import { TILE_BOUNDS } from './useAlbumWallLayout.ts';
import type { AlbumWallRows } from './useAlbumWallRows.ts';
import { useService } from '../../kit/useService.ts';
import { useStore } from 'jotai/react';
import { albumsKey } from '../albumServices.ts';

/** 焦点落在哪一块：专辑键加所在的节，同一张专辑在几节里各有一块时认得出是哪一块。 */
export interface WallFocus {
  readonly key: AlbumKey;
  readonly section: string | null;
}

/** 图块的动作，加上键盘开菜单用的那一条：菜单的作用对象按落点在不在选择里定。 */
interface WallHandlers extends TileHandlers {
  openMenu(album: Album, at: GridPosition | undefined, point: MenuPoint): void;
}

export interface AlbumWallInputOptions {
  readonly scroller: RefObject<HTMLDivElement | null>;
  readonly layout: AlbumWallLayout;
  readonly rows: AlbumWallRows;
  readonly tileId: (at: GridPosition) => string;
  /** 专辑菜单的作用对象已经交给菜单服务，该在 `point` 处打开菜单了。 */
  readonly onMenu: (point: MenuPoint) => void;
  /** 开合这张（在这一节里的那一块）的下拉：单击与空格。 */
  readonly onToggle: (album: Album, sectionKey: string | null) => void;
}

export interface AlbumWallInput {
  readonly focus: WallFocus | null;
  readonly setFocus: (focus: WallFocus | null) => void;
  readonly position: GridPosition | undefined;
  readonly handlers: TileHandlers;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onKeyUp: (event: KeyboardEvent<HTMLElement>) => void;
  /** 打字即跳；输入模型在 effect 里建，首帧之前为 null。 */
  readonly search: TypeSearch | null;
}

function sectionAt(items: readonly GridItem[], at: GridPosition): string | null {
  const item = items[at.index];
  return item?.kind === 'row' ? item.sectionKey : null;
}

/**
 * 封面墙的输入：键盘（经 `createAlbumGridInput`）、单击、双击、右键、Shift + 滚轮与拖动的起手，
 * 落到焦点、多选、下拉、菜单、播放、偏好与拖动服务上。键只在网格元素自己拿着焦点时处理，节头按钮与
 * 下拉里的键归它们自己；处理过的键拦下缺省，命令登记处就不再接手，没处理的（Alt+← 这类）照常往上走。
 */
export function useAlbumWallInput(options: AlbumWallInputOptions): AlbumWallInput {
  const albums = useService(albumsKey);
  const store = useStore();
  const { items } = options.layout;
  const [focus, setFocus] = useState<WallFocus | null>(null);
  const position = useMemo(
    () => (focus ? gridIndexOf(items, focus.key, focus.section) : undefined),
    [items, focus],
  );
  const latest = useRef({ options, position });
  useLayoutEffect(() => {
    latest.current = { options, position };
  });

  const [input, setInput] = useState<AlbumGridInput | null>(null);
  const [handlers] = useState<WallHandlers>(() => {
    const reading = (at: GridPosition) =>
      readingPositionOf(latest.current.options.layout.items, at);
    const land = (album: Album, at: GridPosition) =>
      setFocus({
        key: albumKeyOf(album),
        section: sectionAt(latest.current.options.layout.items, at),
      });
    const openMenu = (album: Album, at: GridPosition | undefined, point: MenuPoint) => {
      const targets = albums.selection.menuTargets(album, at && reading(at));
      void albums.menu.prepare(targets);
      latest.current.options.onMenu(point);
    };
    return {
      select(album, at, modifiers) {
        // 单击说明这次按下没有拖起来：为拖出换凭证的那一串请求作废。
        albums.drag.cancel();
        land(album, at);
        albums.selection.activate(album, modifiers, reading(at));
      },
      toggle: (album, at) =>
        latest.current.options.onToggle(album, sectionAt(latest.current.options.layout.items, at)),
      play: (album) => void albums.actions.play(album),
      menu(album, at, point) {
        land(album, at);
        openMenu(album, at, point);
      },
      press(album, at, event) {
        const plain = !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
        if (event.button !== 0 || event.pointerType !== 'mouse' || !plain) return;
        albums.drag.prepare(albums.selection.targetsOf(album, reading(at)));
      },
      dragStart(album, at, event) {
        albums.drag.start(event.dataTransfer, albums.selection.targetsOf(album, reading(at)));
      },
      acquire: (album) => albums.covers.acquire(album),
      settle: (album, outcome) => albums.covers.settle(album, outcome),
      wait: (retry) => albums.covers.wait(retry),
      openMenu,
    };
  });

  // 输入模型带着打字即跳的定时器，建在 effect 里才释放得掉；StrictMode 的二次 effect 会重建一份。
  useEffect(() => {
    const view = () => latest.current.options;
    const created = createAlbumGridInput(
      {
        items: () => view().layout.items,
        position: () => latest.current.position,
        pageRows: () =>
          Math.floor((view().scroller.current?.clientHeight ?? 0) / view().layout.rowHeight),
        menuAnchor: () => {
          const at = latest.current.position;
          const box = (
            (at && document.getElementById(view().tileId(at))) ??
            view().scroller.current
          )?.getBoundingClientRect();
          return { x: box?.left ?? 0, y: box?.bottom ?? 0 };
        },
      },
      {
        focus(album, at, modifiers) {
          if (at) setFocus({ key: albumKeyOf(album), section: sectionAt(view().layout.items, at) });
          if (at && modifiers) {
            albums.selection.activate(album, modifiers, readingPositionOf(view().layout.items, at));
          }
        },
        selectAll: () => albums.selection.selectAll(),
        play: (album) => void albums.actions.play(album),
        zoom(notches) {
          const size = store.get(browserPrefsAtom).tileSize;
          const next = stepTileSize(size, notches, TILE_SIZE_STEP, TILE_BOUNDS);
          if (next !== undefined) albums.prefs.setTileSize(next);
        },
        scrollTo: (index) => view().rows.virtualizer.scrollToIndex(index, { align: 'auto' }),
        contextMenu: (album, point) => handlers.openMenu(album, latest.current.position, point),
        toggle: (album, sectionKey) => view().onToggle(album, sectionKey),
      },
    );
    setInput(created);
    return () => created.dispose();
  }, [albums, store, handlers]);

  // Shift + 滚轮调封面大小要拦下缺省的横向滚动；React 的 wheel 监听是被动的，拦不住，只能直接挂。
  useEffect(() => {
    const element = options.scroller.current;
    if (!element || !input) return;
    const wheel = (event: WheelEvent) => input.wheel(event);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [input, options.scroller]);

  return {
    focus,
    setFocus,
    position,
    handlers,
    onKeyDown: (event) => {
      if (event.target === event.currentTarget) input?.keydown(event);
    },
    onKeyUp: (event) => {
      if (event.target === event.currentTarget) input?.keyup(event);
    },
    search: input?.typeSearch ?? null,
  };
}
