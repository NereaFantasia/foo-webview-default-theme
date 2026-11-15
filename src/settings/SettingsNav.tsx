import {
  Button,
  makeStyles,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Nav,
  tokens,
  useArrowNavigationGroup,
} from '@fluentui/react-components';
import { ChevronDown20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, type ReactElement, type RefObject } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { ScrollMenu as Menu, ScrollMenuPopover as MenuPopover } from '../kit/ScrollMenuPopover.tsx';
import { SidebarItem } from '../nav/sidebar/SidebarItem.tsx';
import { useSelectionIndicator } from '../kit/useSelectionIndicator.ts';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import styles from './SettingsNav.module.css';

export interface SettingsNavItem {
  /** 分区名，与 `SettingsGroup` 的 `group` 相同 */
  readonly id: string;
  readonly label: string;
  readonly icon: ReactElement;
}

export interface SettingsNavProps {
  readonly items: readonly SettingsNavItem[];
  /** 亮着的那一区 */
  readonly current: string;
  /** 页面窄：目录收成页顶的分区名，点开是一张菜单 */
  readonly narrow: boolean;
  onSelect(id: string): void;
}

const useStyles = makeStyles({
  directory: { gap: tokens.spacingVerticalXXS, padding: 0, minWidth: 0 },
  // 分区名就是页标题：字号同分区大标题，左缘与卡对齐
  title: {
    minWidth: 0,
    paddingInline: 0,
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase600,
  },
});

interface LayoutProps extends SettingsNavProps {
  /** 换排法时焦点在不在卸掉的那一排里，由卸掉的一方记下、换上的一方取走 */
  readonly handoff: RefObject<boolean>;
}

/**
 * 设置页的分区导航：点一项换右边显示的分区，不滚动。宽的时候是卡列左边的目录，导航项与侧边栏同一种；
 * 窄的时候目录收成页顶的分区名，点开选分区
 */
export function SettingsNav(props: SettingsNavProps) {
  const handoff = useRef(false);
  return props.narrow ? (
    <SettingsTitleMenu {...props} handoff={handoff} />
  ) : (
    <SettingsDirectory {...props} handoff={handoff} />
  );
}

/**
 * 页宽跨过分界时目录与分区名互换，旧的一排卸掉，焦点在它里面的话会掉到 body。卸掉时记下焦点在不在里面，
 * 换上的一排挂上时把焦点交给它亮着的那一项。卸掉一方的布局清理跑在节点移出文档之前，还查得到焦点
 */
function useFocusHandoff(root: RefObject<HTMLElement | null>, handoff: RefObject<boolean>) {
  useLayoutEffect(() => {
    const element = root.current;
    if (handoff.current) {
      handoff.current = false;
      element?.querySelector<HTMLElement>('[aria-current], [data-settings-title]')?.focus();
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

function SettingsTitleMenu({ items, current, onSelect, handoff }: LayoutProps) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const root = useRef<HTMLElement>(null);
  useFocusHandoff(root, handoff);
  const label = items.find((item) => item.id === current)?.label ?? '';
  return (
    <nav
      ref={root}
      className={styles.titleBar}
      aria-label={t('settings.nav')}
      data-settings-nav="menu"
    >
      <Menu
        checkedValues={{ section: [current] }}
        onCheckedValueChange={(_, data) => {
          const next = data.checkedItems[0];
          if (next !== undefined) onSelect(next);
        }}
      >
        <MenuTrigger disableButtonEnhancement>
          <Button
            appearance="transparent"
            className={classes.title}
            icon={<ChevronDown20Regular />}
            iconPosition="after"
            data-settings-title
          >
            {label}
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {items.map((item) => (
              <MenuItemRadio key={item.id} name="section" value={item.id} icon={item.icon}>
                {item.label}
              </MenuItemRadio>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>
    </nav>
  );
}
