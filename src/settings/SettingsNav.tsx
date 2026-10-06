import { makeStyles, Nav, tokens, useArrowNavigationGroup } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef, type ReactElement, type RefObject } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { SidebarItem } from '../nav/sidebar/SidebarItem.tsx';
import { useSelectionIndicator } from '../kit/useSelectionIndicator.ts';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import styles from './SettingsNav.module.css';

export interface SettingsNavItem {
  /** 组名，与 `SettingsGroup` 的 `group` 相同。 */
  readonly id: string;
  readonly label: string;
  readonly icon: ReactElement;
}

export interface SettingsNavProps {
  readonly items: readonly SettingsNavItem[];
  /** 亮着的那一组。 */
  readonly current: string;
  /** 页面窄：排成页标题下面的一行，只写组名。 */
  readonly strip: boolean;
  onSelect(id: string): void;
}

const useStyles = makeStyles({
  directory: { gap: tokens.spacingVerticalXXS, padding: 0, minWidth: 0 },
});

interface LayoutProps extends SettingsNavProps {
  /** 换排法时焦点在不在卸掉的那一排里，由卸掉的一方记下、换上的一方取走。 */
  readonly handoff: RefObject<boolean>;
}

/**
 * 设置页的分类导航：页内导航，点一项滚到那一组，不换页。宽的时候是卡列左边的目录，导航项与侧边栏
 * 同一种；窄的时候是页标题下面的一行，放不下时横向滚。
 */
export function SettingsNav(props: SettingsNavProps) {
  const handoff = useRef(false);
  return props.strip ? (
    <SettingsStrip {...props} handoff={handoff} />
  ) : (
    <SettingsDirectory {...props} handoff={handoff} />
  );
}

/**
 * 页宽跨过分界时目录与分类条互换，旧的一排卸掉，焦点在它里面的话会掉到 body。卸掉时记下焦点在不在里面，
 * 换上的一排挂上时把焦点交给它亮着的那一项。卸掉一方的布局清理跑在节点移出文档之前，还查得到焦点。
 */
function useFocusHandoff(root: RefObject<HTMLElement | null>, handoff: RefObject<boolean>) {
  useLayoutEffect(() => {
    const element = root.current;
    if (handoff.current) {
      handoff.current = false;
      element?.querySelector<HTMLElement>('[aria-current]')?.focus();
    }
    return () => {
      handoff.current = element?.contains(document.activeElement) ?? false;
    };
  }, [root, handoff]);
}

function SettingsDirectory({ items, current, onSelect, handoff }: LayoutProps) {
  const t = useAtomValueRawSync(translateAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const classes = useStyles();
  const root = useRef<HTMLDivElement>(null);
  const arrows = useArrowNavigationGroup({ axis: 'vertical', memorizeCurrent: true });
  useSelectionIndicator(root, current, reduced);
  useFocusHandoff(root, handoff);
  return (
    <Nav
      ref={root}
      role="navigation"
      aria-label={t('settings.nav')}
      className={classes.directory}
      selectedValue={current}
      data-settings-nav="directory"
      {...arrows}
    >
      {items.map((item) => (
        <SidebarItem
          key={item.id}
          value={item.id}
          icon={item.icon}
          label={item.label}
          selected={item.id === current}
          onSelect={() => onSelect(item.id)}
        />
      ))}
    </Nav>
  );
}

function SettingsStrip({ items, current, onSelect, handoff }: LayoutProps) {
  const t = useAtomValueRawSync(translateAtom);
  const root = useRef<HTMLElement>(null);
  const arrows = useArrowNavigationGroup({ axis: 'horizontal', memorizeCurrent: true });
  useFocusHandoff(root, handoff);

  // 亮着的那一项滚出了这一行就带回来；竖直方向已经看得见，不会去动外面的滚动。
  useEffect(() => {
    root.current
      ?.querySelector('[aria-current]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  return (
    <nav
      ref={root}
      className={styles.strip}
      aria-label={t('settings.nav')}
      data-settings-nav="strip"
      {...arrows}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === current ? `${styles.tab} ${styles.current}` : styles.tab}
          aria-current={item.id === current ? 'true' : undefined}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
