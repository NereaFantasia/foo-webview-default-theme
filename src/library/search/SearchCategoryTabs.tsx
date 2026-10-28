import {
  MenuButton,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Tab,
  TabList,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import type { SearchCategory } from './searchServices.ts';

const CATEGORIES: readonly SearchCategory[] = ['all', 'artists', 'albums', 'tracks'];
const LABELS: Readonly<Record<SearchCategory, MessageKey>> = {
  all: 'search.all',
  artists: 'search.artists',
  albums: 'search.albums',
  tracks: 'search.tracks',
};

/** 检索分类选项定义 */
export interface CategoryOption<C extends string> {
  readonly value: C;
  readonly label: string;
  /** 分类不可用提示文本；存在时呈现禁用样式，悬浮展示原因 */
  readonly unavailable?: string;
}

const useStyles = makeStyles({
  // 使用自定义禁用样式而非原生 disabled，确保悬浮提示在不可用状态下正常触发
  unavailable: {
    color: tokens.colorNeutralForegroundDisabled,
    cursor: 'not-allowed',
    ':hover': {
      color: tokens.colorNeutralForegroundDisabled,
      backgroundColor: 'transparent',
    },
    ':hover:active': {
      color: tokens.colorNeutralForegroundDisabled,
      backgroundColor: 'transparent',
    },
  },
});

/** 检索结果分类控制栏：宽屏模式展示横向页签，窄屏折叠为下拉菜单，支持不可用分类悬浮提示 */
export function CategoryTabs<C extends string>({
  category,
  options,
  narrow,
  label,
  onChoose,
}: {
  readonly category: C;
  readonly options: readonly CategoryOption<C>[];
  readonly narrow: boolean;
  /** 分类组无障碍标签，兼作窄屏按钮文案上下文 */
  readonly label: string;
  onChoose(category: C): void;
}) {
  const controls = useViewControlStyles();
  const styles = useStyles();
  const current = options.find((option) => option.value === category);
  const choose = (value: unknown) => {
    const next = options.find((option) => option.value === value);
    if (next && !next.unavailable) onChoose(next.value);
  };
  if (narrow)
    return (
      <Menu
        surfaceMotion={MENU_SURFACE_MOTION}
        checkedValues={{ category: [category] }}
        onCheckedValueChange={(_, data) => {
          const next = options.find((option) => data.checkedItems.includes(option.value));
          if (next) choose(next.value);
        }}
      >
        <MenuTrigger disableButtonEnhancement>
          <MenuButton
            appearance="subtle"
            className={controls.icon}
            aria-label={`${label}: ${current?.label ?? ''}`}
            data-search-category={category}
          >
            {current?.label}
          </MenuButton>
        </MenuTrigger>
        <MenuPopover>
          <MenuList aria-label={label}>
            {options.map((option) => {
              const item = (
                <MenuItemRadio
                  key={option.value}
                  name="category"
                  value={option.value}
                  disabled={!!option.unavailable}
                >
                  {option.label}
                </MenuItemRadio>
              );
              return option.unavailable ? (
                <Tooltip key={option.value} content={option.unavailable} relationship="description">
                  {item}
                </Tooltip>
              ) : (
                item
              );
            })}
          </MenuList>
        </MenuPopover>
      </Menu>
    );
  return (
    <TabList
      selectedValue={category}
      onTabSelect={(_, data) => choose(data.value)}
      aria-label={label}
    >
      {options.map((option) => {
        const tab = (
          <Tab
            key={option.value}
            value={option.value}
            aria-disabled={option.unavailable ? true : undefined}
            className={mergeClasses(option.unavailable && styles.unavailable)}
          >
            {option.label}
          </Tab>
        );
        return option.unavailable ? (
          <Tooltip key={option.value} content={option.unavailable} relationship="description">
            {tab}
          </Tooltip>
        ) : (
          tab
        );
      })}
    </TabList>
  );
}

/** 媒体库本地检索分类页签 */
export function SearchCategoryTabs({
  category,
  narrow,
  onChoose,
}: {
  readonly category: SearchCategory;
  readonly narrow: boolean;
  onChoose(category: SearchCategory): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <CategoryTabs
      category={category}
      options={CATEGORIES.map((value) => ({ value, label: t(LABELS[value]) }))}
      narrow={narrow}
      label={t('place.search')}
      onChoose={onChoose}
    />
  );
}
