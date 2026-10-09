import {
  makeStyles,
  mergeClasses,
  Nav,
  tokens,
  useArrowNavigationGroup,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { useShellSlots } from '../shellSlots.ts';
import { playlistsAtom } from '../../playback/playlists.ts';
import { historyAtom, historyKey } from '../../nav/navHistory.ts';
import { PANE_ONLY_ATTR } from '../../nav/sidebar/paneFades.ts';
import { PLACE_LABELS } from '../../nav/places.ts';
import styles from './Sidebar.module.css';
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
import { sidebarPrefsAtom, sidebarPrefsKey } from '../../nav/sidebar/sidebarPrefs.ts';
import { SidebarSection } from '../../nav/sidebar/SidebarSection.tsx';
import { useSelectionIndicator } from '../../kit/useSelectionIndicator.ts';
import { useService } from '../../kit/useService.ts';

// 左留 8，与标题栏的 ⋯ 和图标态的项对齐；右留 4，加上内容区左侧的 8，离内容卡 12。
const useStyles = makeStyles({
  nav: {
    gap: tokens.spacingVerticalXXS,
    height: '100%',
    minHeight: 0,
    boxSizing: 'border-box',
    padding: `0 ${tokens.spacingHorizontalXS} ${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
  },
});

/** 只在展开态里有的部分：换成图标态时淡出，从图标态换回来时淡入（`paneFades.ts`）。 */
const PANE_ONLY = { [PANE_ONLY_ATTR]: true };

/**
 * 侧边栏：搜索框、首页、资料库、播放列表节，设置钉在底部。直接坐在窗口的材质上，不做卡片。
 *
 * 点哪一项都是去一个地点，经全局历史切过去；亮哪一项跟着历史的当前地点走，不自己记。
 * 搜索框内的方向键归搜索建议，其他位置的上下方向键在各项之间移动焦点。图标态（`SidebarRail`）里两种形态都有的
 * 项摆在同样的高度，换形态时不跳。
 */
export function Sidebar({ className }: { readonly className?: string }) {
  const slots = useShellSlots();
  const t = useAtomValueRawSync(translateAtom);
  const { place } = useAtomValueRawSync(historyAtom);
  const { sections } = useAtomValueRawSync(sidebarPrefsAtom);
  const { items } = useAtomValueRawSync(playlistsAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const history = useService(historyKey);
  const sidebar = useService(sidebarPrefsKey);
  const classes = useStyles();
  const root = useRef<HTMLDivElement>(null);
  const arrows = useArrowNavigationGroup({ axis: 'vertical', memorizeCurrent: true });

  const selection = sidebarSelectionOf(place);
  let selected: string | null = null;
  if (selection?.kind === 'item') selected = itemKey(selection.id);
  else if (selection?.kind === 'playlist') {
    const { subject } = selection;
    // 列表删了就一处都不亮，不挪到别的列表上。
    selected = items.some((item) => item.guid === subject) ? playlistKey(subject) : null;
  }
  useSelectionIndicator(root, selected, reduced);

  const entry = (item: SidebarEntry) => (
    <SidebarItem
      key={item.id}
      value={itemKey(item.id)}
      icon={<SidebarIcon id={item.id} />}
      label={t(PLACE_LABELS[item.place])}
      selected={selected === itemKey(item.id)}
      ready={item.ready}
      onSelect={() => history.navigate({ id: item.place })}
    />
  );

  return (
    <Nav
      ref={root}
      role="navigation"
      aria-label={t('sidebar.label')}
      className={mergeClasses(classes.nav, className)}
      selectedValue={selected ?? ''}
      {...arrows}
    >
      <div className={styles.search} {...PANE_ONLY}>
        <slots.SidebarSearch />
      </div>
      <div className={styles.group}>{TOP_ITEMS.map(entry)}</div>
      <SidebarSection
        className={styles.group}
        label={t('sidebar.library')}
        expanded={sections.library}
        onToggle={() => sidebar.toggleSection('library')}
      >
        {LIBRARY_ITEMS.map(entry)}
      </SidebarSection>
      <div className={styles.playlists} {...PANE_ONLY}>
        <slots.SidebarPlaylists className={styles.fill} selected={selected} />
      </div>
      <div className={styles.footer}>{entry(SETTINGS_ITEM)}</div>
    </Nav>
  );
}
