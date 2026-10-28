import {
  Button,
  ToggleButton,
  Toolbar,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { ArrowLeft20Regular, Search20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import styles from './CommandBar.module.css';
import type { WidthTier } from './useWidthTier.ts';

export type CommandBarTier = 'wide' | 'medium' | 'narrow';

/** 按页面内容宽分档：宽档键带文字，中档只留图标，窄档搜索框收成图标键。标签固定，所以断点也固定 */
export const COMMAND_BAR_TIERS: readonly [
  WidthTier<CommandBarTier>,
  ...WidthTier<CommandBarTier>[],
] = [
  { tier: 'wide', min: 720 },
  { tier: 'medium', min: 560 },
  { tier: 'narrow', min: 0 },
];

/** 命令栏里带文字的键：Fluent 中号按钮的最小宽 96 会把两个字的键撑得很空，改为随内容 */
export const useCommandButtonStyles = makeStyles({
  labelled: {
    minWidth: 'auto',
    paddingLeft: tokens.spacingHorizontalS,
    paddingRight: tokens.spacingHorizontalS,
  },
});

const useStyles = makeStyles({
  tools: { padding: 0, columnGap: tokens.spacingHorizontalXS },
});

export interface CommandBarSearch {
  /** 搜索框本身 */
  readonly box: ReactNode;
  /** 框里有字：窄档的搜索键显示按下态 */
  readonly active: boolean;
}

export interface CommandBarProps {
  readonly tier: CommandBarTier;
  /** 命令栏的无障碍名称 */
  readonly label: string;
  readonly search?: CommandBarSearch;
  /** 查找组里搜索框后面的键，如筛选 */
  readonly find?: ReactNode;
  /** 栏右端的视图组：排序、视图 */
  readonly view: ReactNode;
  /** 选中两项以上时的选区操作，代替搜索与查找组 */
  readonly selection?: ReactNode;
}

/**
 * 集合页的命令栏：左边查找，右边视图，下面不画线。键放在 Fluent Toolbar 里，整栏一个 Tab 停靠、方向键在栏内移动；
 * 搜索框要用方向键移光标，所以放在 Toolbar 外面，单独一个停靠。窄档的搜索框收成图标键，点开后在栏内铺开、盖住
 * 其余的键；返回键或在空框里按 Esc 收回
 */
export function CommandBar({ tier, label, search, find, view, selection }: CommandBarProps) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const classes = useStyles();
  const [searching, setSearching] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // 收回后焦点回到搜索键；只在用户收回时这样做，换档时不抢焦点
  const refocus = useRef(false);
  const expanded = tier === 'narrow' && searching && search !== undefined && !selection;
  const collapse = () => {
    refocus.current = true;
    setSearching(false);
  };

  useEffect(() => {
    if (expanded) field.current?.querySelector('input')?.focus();
    else if (refocus.current) opener.current?.focus();
    refocus.current = false;
  }, [expanded]);

  if (expanded) {
    return (
      <div className={styles.bar} data-tier={tier} data-command-bar="searching">
        <Tooltip content={t('query.searchClose')} relationship="label">
          <Button
            appearance="subtle"
            className={controls.icon}
            icon={<ArrowLeft20Regular />}
            onClick={collapse}
            data-command-search-close
          />
        </Tooltip>
        <div
          ref={field}
          className={styles.expanded}
          onKeyDown={(event) => {
            const input = event.target;
            if (event.key !== 'Escape' || !(input instanceof HTMLInputElement)) return;
            if (input.value !== '') return;
            event.preventDefault();
            event.stopPropagation();
            collapse();
          }}
        >
          {search.box}
        </div>
      </div>
    );
  }

  const searchKey = tier === 'narrow' && search && !selection && (
    <Tooltip content={t('query.search')} relationship="label">
      <ToggleButton
        ref={opener}
        appearance="subtle"
        className={controls.icon}
        checked={search.active}
        icon={<Search20Regular />}
        onClick={() => setSearching(true)}
        data-command-search-open
      />
    </Tooltip>
  );
  return (
    <div className={styles.bar} data-tier={tier} data-command-bar={selection ? 'selection' : ''}>
      {!selection && search && tier !== 'narrow' && (
        <div className={styles.search} data-command-search>
          {search.box}
        </div>
      )}
      <Toolbar aria-label={label} className={mergeClasses(classes.tools, styles.tools)}>
        {selection || (
          <>
            {searchKey}
            {find}
          </>
        )}
        <span className={styles.spacer} aria-hidden />
        {view}
      </Toolbar>
    </div>
  );
}
