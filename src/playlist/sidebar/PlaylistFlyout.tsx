import { makeStyles, Nav, Portal, useArrowNavigationGroup } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { sidebarPrefsAtom } from '../../nav/sidebar/sidebarPrefs.ts';
import { useLightDismiss } from '../../nav/useLightDismiss.ts';
import { MenuMotion } from '../../motion/MenuMotion.tsx';
import { playlistKey } from '../../nav/sidebar/sidebarNav.ts';
import styles from './PlaylistFlyout.module.css';
import { NEW_PLAYLIST_ATTR, SidebarPlaylists } from './SidebarPlaylists.tsx';

export interface PlaylistFlyoutProps {
  /** 图标态里的「播放列表」图标：浮层贴着它的右边弹出，点它不算点在外面。 */
  readonly anchor: RefObject<HTMLElement | null>;
  /** 侧边栏此刻点亮的选中键。 */
  readonly selected: string | null;
  /** 浮层的根，拖放悬停按它认「在浮层里」。 */
  readonly panel: RefObject<HTMLDivElement | null>;
  /** 轻关：`escape` 为真是按了 Esc，焦点该回到图标上。 */
  onDismiss(escape: boolean): void;
}

/** 离窗口边与图标的距离，CSS 像素。 */
const EDGE = 8;
/** 图标太靠下时，浮层至少留这么高，往上挪。 */
const MIN_HEIGHT = 240;

const useStyles = makeStyles({
  nav: { flex: '1 1 auto', minHeight: 0 },
});

interface FlyoutBox {
  readonly left: number;
  readonly top: number;
  readonly maxHeight: number;
}

/** 顶边与图标齐平、往下展开到窗口底；图标太靠下放不开时整张往上挪。 */
function boxFor(anchor: HTMLElement): FlyoutBox {
  const rect = anchor.getBoundingClientRect();
  const bottom = window.innerHeight - EDGE;
  let top = rect.top - EDGE;
  if (bottom - top < MIN_HEIGHT) top = Math.max(EDGE, bottom - MIN_HEIGHT);
  return { left: rect.right + EDGE, top, maxHeight: bottom - top };
}

/** 刚打开时焦点落在哪：正在看的那张，没有就第一张，再没有就「新建」。 */
function initialFocus(panel: HTMLElement, selected: string | null): HTMLElement | null {
  const rows = [...panel.querySelectorAll<HTMLElement>('[data-playlist-entry]')];
  const current = rows.find((row) => playlistKey(row.dataset['playlistEntry'] ?? '') === selected);
  return current ?? rows[0] ?? panel.querySelector<HTMLElement>(`[${NEW_PLAYLIST_ATTR}]`);
}

/**
 * 图标态里点「播放列表」弹出的浮层：就是展开态的播放列表节本身，新建、改名、右键菜单、拖动重排、筛选都照样
 * 能做，只是这一节不能收起。改名或新建进行中点外面不关，只让名字框失焦提交。
 *
 * 入场照菜单的做法，83 ms 淡入配 250 ms 从图标一侧滑出；关掉时直接收起。宽度用侧边栏存的展开宽度。
 */
export function PlaylistFlyout({ anchor, selected, panel, onDismiss }: PlaylistFlyoutProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { width } = useAtomValueRawSync(sidebarPrefsAtom);
  const classes = useStyles();
  const arrows = useArrowNavigationGroup({ axis: 'vertical', memorizeCurrent: true });
  const [box, setBox] = useState<FlyoutBox | null>(null);
  const focused = useRef(false);

  const markInside = useLightDismiss({
    id: 'sidebar.playlistFlyout.dismiss',
    open: true,
    panel,
    exempt: (target) => anchor.current?.contains(target) ?? false,
    held: () =>
      (panel.current?.querySelector('[data-rename-input], [data-new-playlist-input]') ?? null) !==
      null,
    onDismiss,
  });

  useLayoutEffect(() => {
    if (anchor.current) setBox(boxFor(anchor.current));
  }, [anchor]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!box || !element || focused.current) return;
    focused.current = true;
    initialFocus(element, selected)?.focus();
  }, [box, panel, selected]);

  if (!box) return null;
  return (
    <Portal>
      <MenuMotion visible appear>
        <div
          ref={panel}
          className={styles.flyout}
          style={{ left: box.left, top: box.top, maxHeight: box.maxHeight, width }}
          role="dialog"
          aria-label={t('sidebar.playlists')}
          data-playlist-flyout
          onPointerDownCapture={markInside}
        >
          <Nav className={classes.nav} selectedValue={selected ?? ''} {...arrows}>
            <SidebarPlaylists className={styles.section} selected={selected} collapsible={false} />
          </Nav>
        </div>
      </MenuMotion>
    </Portal>
  );
}
