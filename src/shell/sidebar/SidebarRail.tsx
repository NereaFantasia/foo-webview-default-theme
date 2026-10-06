import {
  makeStyles,
  Nav,
  NavDivider,
  tokens,
  useArrowNavigationGroup,
} from '@fluentui/react-components';
import { List20Regular, Search20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { useShellSlots } from '../shellSlots.ts';
import { playlistsAtom } from '../../playback/playlists.ts';
import { createDragHover, type DragHoverSpot } from './dragHover.ts';
import { historyAtom, historyKey } from '../../nav/navHistory.ts';
import { PANE_ONLY_ATTR } from '../../nav/sidebar/paneFades.ts';
import { PLACE_LABELS } from '../../nav/places.ts';
import styles from './SidebarRail.module.css';
import { SidebarIcon } from './SidebarIcon.tsx';
import { SidebarItem } from '../../nav/sidebar/SidebarItem.tsx';
import {
  itemKey,
  LIBRARY_ITEMS,
  playlistKey,
  SETTINGS_ITEM,
  sidebarSelectionOf,
  TOP_ITEMS,
  type SidebarEntry,
} from '../../nav/sidebar/sidebarNav.ts';
import { sidebarPrefsAtom } from '../../nav/sidebar/sidebarPrefs.ts';
import { useSelectionIndicator } from '../../kit/useSelectionIndicator.ts';
import { useService } from '../../kit/useService.ts';

/** 图标态里代表整个播放列表节的那一项的选中键。 */
const RAIL_PLAYLISTS = 'rail:playlists';

// 宽 48：左留 8、右不留，图标项 40 × 32，与标题栏的键同宽同位，加上内容区左侧的 8，图标在窗口边与内容卡
// 之间居中。放大镜与细线占的高度同展开态的搜索框与分节标题，下面各项与展开态同高。
const useStyles = makeStyles({
  nav: {
    alignItems: 'center',
    gap: tokens.spacingVerticalXXS,
    height: '100%',
    minHeight: 0,
    boxSizing: 'border-box',
    padding: `0 0 ${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
  },
  search: { flex: 'none', marginBottom: tokens.spacingVerticalSNudge },
  divider: {
    flex: 'none',
    width: '100%',
    height: '32px',
    margin: `${tokens.spacingVerticalSNudge} 0 0`,
  },
});

/** 只在图标态里有的部分：从展开态换过来时淡入（`paneFades.ts`）。 */
const PANE_ONLY = { [PANE_ONLY_ATTR]: true };

/**
 * 侧边栏的图标态：宽 48，只有图标，悬停出名字。分节标题换成细线，资料库各项不论那一节收没收起都画出来，
 * 开合的存档不动。搜索收成放大镜，点开带输入框的浮层。两种形态都有的项摆在与展开态同样的位置。
 *
 * 播放列表节收成一个图标，点它在右边弹出列表浮层；拖着专辑或文件停在它上面也会弹出。有列表在播时它的
 * 右上角点小圆点。选中与展开态同一套：浅底加竖条，正在看一张列表时亮
 * 播放列表图标。
 */
export function SidebarRail() {
  const slots = useShellSlots();
  const showSearch = slots.useShowSearch();
  const t = useAtomValueRawSync(translateAtom);
  const { place } = useAtomValueRawSync(historyAtom);
  const { items } = useAtomValueRawSync(playlistsAtom);
  const { sections } = useAtomValueRawSync(sidebarPrefsAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const history = useService(historyKey);
  const classes = useStyles();
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const arrows = useArrowNavigationGroup({ axis: 'vertical', memorizeCurrent: true });
  const [flyout, setFlyout] = useState(false);
  const openNow = useRef(flyout);
  openNow.current = flyout;
  const [hover] = useState(() =>
    createDragHover({
      isOpen: () => openNow.current,
      open: () => setFlyout(true),
      close: () => setFlyout(false),
    }),
  );

  const focusAnchor = () => anchor.current?.querySelector<HTMLElement>('button')?.focus();

  const selection = sidebarSelectionOf(place);
  let selected: string | null = null;
  let inFlyout: string | null = null;
  if (selection?.kind === 'item') {
    selected = selection.id === 'playlists' ? RAIL_PLAYLISTS : itemKey(selection.id);
    inFlyout = itemKey(selection.id);
  } else if (selection?.kind === 'playlist') {
    const { subject } = selection;
    const shown = items.some((item) => item.guid === subject);
    selected = shown ? RAIL_PLAYLISTS : null;
    inFlyout = shown ? playlistKey(subject) : null;
  }
  useSelectionIndicator(root, selected, reduced);

  // 去了别的地点（在浮层里点了一张列表、新建成了一张）浮层就关；焦点在浮层里就还给图标。
  const placeKey = `${place.id}:${place.subject ?? ''}`;
  const lastPlace = useRef(placeKey);
  useEffect(() => {
    if (lastPlace.current === placeKey) return;
    lastPlace.current = placeKey;
    if (panel.current?.contains(document.activeElement)) focusAnchor();
    hover.reset();
    setFlyout(false);
  }, [placeKey, hover]);

  useEffect(() => {
    const spotOf = (target: EventTarget | null): DragHoverSpot => {
      if (!(target instanceof Node)) return null;
      if (anchor.current?.contains(target)) return 'anchor';
      return panel.current?.contains(target) ? 'panel' : null;
    };
    const onOver = (event: DragEvent) => hover.over(spotOf(event.target));
    // 拖出窗口时 relatedTarget 为 null，当作到了别处。
    const onLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) hover.over(null);
    };
    const onEnd = () => hover.end();
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('drop', onEnd, true);
    document.addEventListener('dragend', onEnd, true);
    return () => {
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('drop', onEnd, true);
      document.removeEventListener('dragend', onEnd, true);
      hover.dispose();
    };
  }, [hover]);

  const entry = (item: SidebarEntry, dot = false, paneOnly = false) => (
    <SidebarItem
      key={item.id}
      value={itemKey(item.id)}
      icon={<SidebarIcon id={item.id} />}
      label={t(PLACE_LABELS[item.place])}
      selected={selected === itemKey(item.id)}
      ready={item.ready}
      compact
      dot={dot}
      {...(paneOnly ? PANE_ONLY : {})}
      onSelect={() => history.navigate({ id: item.place })}
    />
  );

  return (
    <Nav
      ref={root}
      role="navigation"
      aria-label={t('sidebar.label')}
      className={classes.nav}
      selectedValue={selected ?? ''}
      {...arrows}
    >
      <SidebarItem
        value="action:search"
        icon={<Search20Regular />}
        label={t('sidebar.search')}
        selected={false}
        ready
        compact
        className={classes.search}
        {...PANE_ONLY}
        data-search-trigger
        onSelect={() => showSearch()}
      />
      {TOP_ITEMS.map((item) => entry(item))}
      <NavDivider className={classes.divider} {...PANE_ONLY} />
      {/* 资料库那一节在展开态里收着时，这几项也只在图标态里有。 */}
      {LIBRARY_ITEMS.map((item) => entry(item, false, !sections.library))}
      <NavDivider className={classes.divider} {...PANE_ONLY} />
      <div ref={anchor} className={styles.anchor} {...PANE_ONLY}>
        <SidebarItem
          value={RAIL_PLAYLISTS}
          icon={<List20Regular />}
          label={t('sidebar.playlists')}
          selected={selected === RAIL_PLAYLISTS}
          compact
          dot={items.some((item) => item.isPlaying)}
          aria-haspopup="dialog"
          aria-expanded={flyout}
          onSelect={() => {
            hover.reset();
            setFlyout((open) => !open);
          }}
        />
      </div>
      <div className={styles.footer}>{entry(SETTINGS_ITEM)}</div>
      {flyout && (
        <slots.PlaylistFlyout
          anchor={anchor}
          panel={panel}
          selected={inFlyout}
          onDismiss={(escape) => {
            if (escape) focusAnchor();
            hover.reset();
            setFlyout(false);
          }}
        />
      )}
    </Nav>
  );
}
