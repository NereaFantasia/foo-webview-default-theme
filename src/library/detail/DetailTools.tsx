import { Menu } from '../../motion/Surfaces.tsx';
import { MenuSurface as MenuPopover } from '../../theme/MenuSurface.tsx';
import {
  Button,
  MenuButton,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  SearchBox,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  shorthands,
} from '@fluentui/react-components';
import {
  ArrowDown16Regular,
  ArrowSortDownLines16Regular,
  ArrowUp16Regular,
  Search16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { durationVar, motionDuration } from '../../motion/timing.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import styles from './DetailTools.module.css';

const ENABLED_CONTROL = '&:not(:disabled, [aria-disabled="true"]):not(:has(> :disabled))';
const CHIP_SURFACE = {
  '@media (forced-colors: none)': {
    [ENABLED_CONTROL]: { backgroundColor: 'var(--bg-chip)' },
  },
};

const useStyles = makeStyles({
  icon: {
    width: '32px',
    minWidth: '32px',
    height: '32px',
    color: 'var(--text-secondary)',
    transitionProperty: 'background-color, color',
    transitionDuration: durationVar('faster'),
    transitionTimingFunction: tokens.curveLinear,
  },
  open: { ...CHIP_SURFACE, color: 'var(--text-primary)' },
  active: { color: 'var(--accent)' },
  field: {
    height: '32px',
    width: '126px',
    minWidth: '126px',
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: `calc(${tokens.spacingHorizontalM} + ${tokens.spacingHorizontalXXS})`,
    justifyContent: 'space-between',
    fontWeight: tokens.fontWeightRegular,
    ...CHIP_SURFACE,
  },
  direction: {
    width: '32px',
    minWidth: '32px',
    height: '32px',
    ...CHIP_SURFACE,
  },
  search: {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    height: '32px',
    borderRadius: tokens.borderRadiusCircular,
    '@media (forced-colors: none)': {
      [ENABLED_CONTROL]: {
        backgroundColor: 'var(--bg-chip)',
        ':focus-within': { ...shorthands.borderColor(tokens.colorBrandStroke1) },
      },
      '::after': { display: 'none' },
    },
  },
  menu: { minWidth: '176px' },
  surface: {
    transitionProperty: 'background-color, border-color',
    transitionDuration: durationVar('faster'),
    transitionTimingFunction: tokens.curveLinear,
    '@media (forced-colors: none)': {
      [ENABLED_CONTROL]: {
        ...shorthands.borderColor(
          `color-mix(in srgb, ${tokens.colorNeutralForeground1} 10%, transparent)`,
        ),
        ':hover': {
          backgroundColor: `color-mix(in oklab, ${tokens.colorNeutralForeground1} 12%, transparent)`,
        },
        ':active,:hover:active,:active:focus-visible': { backgroundColor: 'var(--bg-chip)' },
      },
    },
  },
});

export interface DetailToolsProps<F extends string> {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  /** 排序字段，按菜单里的先后；第一项是列表本来的顺序 */
  readonly fields: readonly F[];
  readonly field: F;
  readonly descending: boolean;
  /** 不是缺省顺序：排序键收起时取页内强调色 */
  readonly sorted: boolean;
  readonly label: (field: F) => string;
  readonly onSort: (field: F, descending: boolean) => void;
  /** 靠左的一句话或一组页签；查找与排序展开时可能被盖住，只放补充说明 */
  readonly start?: ReactNode;
  /** 筛选键，放在查找与排序之间并跟着排序展开一起位移；浮层由页面自己挂，不能挂在这一行里 */
  readonly filter?: ReactNode;
  /** 工具行下面紧接着的一行，如生效的筛选条件；整行共用工具行的下边距 */
  readonly below?: ReactNode;
  /** 查找键与查找框的名字，缺省写查找曲目 */
  readonly findLabel?: string;
  /** 排序键的名字，缺省写曲目排序 */
  readonly sortLabel?: string;
}

/**
 * 详情页头部与曲目表之间的工具行：靠右是查找键、可选的筛选键与排序键，点开查找与排序各自从右侧滑出查找框与字段、方向
 */
export function DetailTools<F extends string>({
  query,
  onQuery,
  fields,
  field,
  descending,
  sorted,
  label,
  onSort,
  start,
  filter,
  below,
  findLabel,
  sortLabel,
}: DetailToolsProps<F>) {
  const t = useAtomValueRawSync(translateAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const classes = useStyles();
  const viewControls = useViewControlStyles();
  const [searchOpen, setSearchOpen] = useState(query !== '');
  const [sortOpen, setSortOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const sorting = useRef<HTMLDivElement>(null);
  const sortButton = useRef<HTMLButtonElement>(null);
  const focusSearch = useRef(false);
  const find = findLabel ?? t('albumDetail.find');
  const sort = sortLabel ?? t('albumDetail.sort');
  const direction = t(descending ? 'albumList.descending' : 'albumList.ascending');
  const finding = searchOpen || query !== '';
  const motionStyle: CSSProperties & Record<'--tool-open' | '--tool-close', string> = {
    '--tool-open': `${motionDuration(200, reduced)}ms`,
    '--tool-close': `${motionDuration(100, reduced)}ms`,
  };

  useLayoutEffect(() => {
    if (query !== '') setSearchOpen(true);
  }, [query]);
  useLayoutEffect(() => {
    if (!focusSearch.current) return;
    focusSearch.current = false;
    (searchOpen ? search.current : searchButton.current)?.focus({ preventScroll: true });
  }, [searchOpen]);

  useCommand({
    id: 'albumDetail.find.escape',
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () => searchOpen && document.activeElement === search.current,
    run: () => {
      if (query !== '') onQuery('');
      else {
        focusSearch.current = true;
        setSearchOpen(false);
      }
    },
  });
  useCommand({
    id: 'albumDetail.sort.escape',
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () => sortOpen && !!sorting.current?.contains(document.activeElement),
    run: () => {
      setSortOpen(false);
      sortButton.current?.focus({ preventScroll: true });
    },
  });

  return (
    <div
      className={styles.root}
      style={motionStyle}
      data-detail-tools
      data-has-filter={filter ? '' : undefined}
    >
      {start && <div className={styles.start}>{start}</div>}
      <div
        className={styles.rail}
        data-find-open={finding || undefined}
        data-sort-open={sortOpen || undefined}
      >
        <div
          className={styles.search}
          onBlur={(event) => {
            if (query === '' && !event.currentTarget.contains(event.relatedTarget))
              setSearchOpen(false);
          }}
        >
          <div className={styles.input} inert={!finding} aria-hidden={!finding}>
            <SearchBox
              ref={search}
              className={mergeClasses(classes.surface, classes.search)}
              appearance="filled-darker"
              contentBefore={<Search16Regular />}
              value={query}
              placeholder={find}
              aria-label={find}
              dismiss={{ 'aria-label': t('query.clear') }}
              onChange={(_, data) => onQuery(data.value)}
              data-detail-find
            />
          </div>
          <div className={styles['search-trigger']} inert={finding} aria-hidden={finding}>
            <Tooltip content={find} relationship="label">
              <Button
                ref={searchButton}
                appearance="subtle"
                shape="circular"
                className={mergeClasses(viewControls.icon, classes.icon)}
                icon={<Search16Regular />}
                aria-label={find}
                aria-expanded={finding}
                data-detail-find-toggle
                onClick={() => {
                  focusSearch.current = true;
                  setSearchOpen(true);
                }}
              />
            </Tooltip>
          </div>
        </div>
        {filter && (
          <div className={styles.filter} data-detail-filter>
            {filter}
          </div>
        )}
        <div ref={sorting} className={styles.sort}>
          <div className={styles['sort-trigger']}>
            <Tooltip content={sort} relationship="label">
              <Button
                ref={sortButton}
                appearance="subtle"
                shape="circular"
                className={mergeClasses(
                  viewControls.icon,
                  classes.icon,
                  sortOpen && classes.open,
                  !sortOpen && sorted && classes.active,
                )}
                icon={<ArrowSortDownLines16Regular />}
                aria-label={sort}
                aria-expanded={sortOpen}
                data-detail-sort-toggle
                data-active={sorted || undefined}
                onClick={() => setSortOpen((open) => !open)}
              />
            </Tooltip>
          </div>
          <div
            className={styles.controls}
            inert={!sortOpen}
            aria-hidden={!sortOpen}
            data-detail-sort-controls
          >
            <Menu
              surfaceMotion={MENU_SURFACE_MOTION}
              checkedValues={{ field: [field] }}
              onCheckedValueChange={(_, data) => {
                const next = fields.find((value) => data.checkedItems.includes(value));
                if (next) onSort(next, descending);
              }}
            >
              <MenuTrigger disableButtonEnhancement>
                <MenuButton
                  appearance="subtle"
                  shape="circular"
                  className={mergeClasses(classes.surface, classes.field)}
                  aria-label={t('albumDetail.sortField')}
                  data-detail-sort-field
                >
                  {label(field)}
                </MenuButton>
              </MenuTrigger>
              <MenuPopover className={classes.menu}>
                <MenuList aria-label={t('albumDetail.sortField')}>
                  {fields.map((value) => (
                    <MenuItemRadio key={value} name="field" value={value}>
                      {label(value)}
                    </MenuItemRadio>
                  ))}
                </MenuList>
              </MenuPopover>
            </Menu>
            <Tooltip content={direction} relationship="label">
              <Button
                appearance="subtle"
                shape="circular"
                className={mergeClasses(classes.surface, classes.direction)}
                icon={descending ? <ArrowDown16Regular /> : <ArrowUp16Regular />}
                aria-label={direction}
                data-detail-sort-direction
                onClick={() => onSort(field, !descending)}
              />
            </Tooltip>
          </div>
        </div>
      </div>
      {below}
    </div>
  );
}
