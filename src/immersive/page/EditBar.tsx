import {
  Button,
  MenuButton,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Tab,
  mergeClasses,
  type MenuProps,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { MenuSurface } from '../../kit/HostMenuList.tsx';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { Menu, TabList } from '../../motion/Surfaces.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { useBarSurface } from '../scene/acrylic.ts';
import { useSceneTabStyles } from '../scene/tabStyles.ts';
import { useRootRadius } from '../scene/useRootRadius.ts';
import styles from './EditBar.module.css';

/** 编辑条上的一个分类：标识与已翻译的名称 */
export interface EditCategory {
  readonly id: string;
  readonly label: string;
}

export interface EditBarProps {
  readonly categories: readonly EditCategory[];
  /** 当前选中的分类 */
  readonly value: string;
  onSelect(id: string): void;
  onCancel(): void;
  onDone(): void;
  /** 退出编辑后的退场期间为真，此时编辑条淡出，不接收指针与焦点 */
  readonly leaving?: boolean;
}

const GROUP = 'category';

/**
 * 设置编辑条：顶部正中的一条 Acrylic，左侧是分类页签，右侧是「取消」与「完成」
 *
 * 页签与侧栏的「歌词 队列 历史」样式相同（`scene/tabStyles.ts`），方向键在分类之间移动。
 * 「完成」是主按钮，按仓库对话框的按钮顺序排在最右。
 * 窗口过窄、放不下整排页签时（样式按窗口宽度切换），页签收成一个显示当前分类名的菜单键，点击后弹出分类的单选菜单。
 * 两种形态都会渲染，隐藏的一种不占位，也不接收焦点
 */
export function EditBar({
  categories,
  value,
  onSelect,
  onCancel,
  onDone,
  leaving = false,
}: EditBarProps) {
  const t = useAtomValueRawSync(translateAtom);
  const surface = useBarSurface();
  const radius = useRootRadius('--scene-edit-bar-radius');
  const tabs = useSceneTabStyles();
  const controls = useViewControlStyles();
  const current = categories.find((category) => category.id === value) ?? categories[0];
  const pick: MenuProps['onCheckedValueChange'] = (_, data) => {
    const id = data.checkedItems[0];
    if (id !== undefined && categories.some((category) => category.id === id)) onSelect(id);
  };
  return (
    <div
      ref={radius}
      className={mergeClasses(styles.bar, surface)}
      role="group"
      aria-label={t('immersive.settings')}
      data-edit-bar
      data-leaving={leaving || undefined}
      inert={leaving}
    >
      <TabList
        size="small"
        className={mergeClasses(tabs.list, styles.tabs)}
        selectedValue={current?.id}
        aria-label={t('immersive.edit.categories')}
        onTabSelect={(_, data) => {
          if (typeof data.value === 'string') onSelect(data.value);
        }}
      >
        {categories.map((category) => (
          <Tab
            key={category.id}
            className={tabs.tab}
            content={{ className: tabs.text }}
            value={category.id}
            data-edit-category={category.id}
          >
            {category.label}
          </Tab>
        ))}
      </TabList>
      <Menu
        checkedValues={{ [GROUP]: current ? [current.id] : [] }}
        onCheckedValueChange={pick}
        surfaceMotion={MENU_SURFACE_MOTION}
      >
        <MenuTrigger disableButtonEnhancement>
          <MenuButton
            appearance="subtle"
            className={mergeClasses(styles.menu, controls.icon)}
            data-edit-category-menu
          >
            {current?.label}
          </MenuButton>
        </MenuTrigger>
        <MenuSurface>
          <MenuList aria-label={t('immersive.edit.categories')}>
            {categories.map((category) => (
              <MenuItemRadio key={category.id} name={GROUP} value={category.id}>
                {category.label}
              </MenuItemRadio>
            ))}
          </MenuList>
        </MenuSurface>
      </Menu>
      <span className={styles.divider} aria-hidden />
      <div className={styles.actions}>
        <Button className={controls.field} onClick={onCancel} data-edit-cancel>
          {t('common.cancel')}
        </Button>
        <Button appearance="primary" onClick={onDone} data-edit-done>
          {t('immersive.edit.done')}
        </Button>
      </div>
    </div>
  );
}
