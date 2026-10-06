import {
  Button,
  Menu,
  MenuButton,
  MenuItemRadio,
  MenuList,
  MenuPopover,
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
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { durationVar, motionDuration } from '../../motion/timing.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { columnDef, type ColumnId } from '../../table/columns/columns.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import { DETAIL_SORT_FIELDS, detailSort, detailSortField } from './albumDetailItems.ts';
import styles from './AlbumDetailTools.module.css';

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
  open: { backgroundColor: 'var(--bg-chip)', color: 'var(--text-primary)' },
  active: { color: 'var(--accent)' },
  field: {
    height: '32px',
    width: '126px',
    minWidth: '126px',
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: `calc(${tokens.spacingHorizontalM} + ${tokens.spacingHorizontalXXS})`,
    justifyContent: 'space-between',
    fontWeight: tokens.fontWeightRegular,
    backgroundColor: 'var(--bg-chip)',
  },
  direction: {
    width: '32px',
    minWidth: '32px',
    height: '32px',
    backgroundColor: 'var(--bg-chip)',
  },
  search: {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    height: '32px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: 'var(--bg-chip)',
    ':focus-within': {
      ...shorthands.borderColor(tokens.colorBrandStroke1),
    },
    '::after': { display: 'none' },
  },
  menu: { minWidth: '176px' },
  surface: {
    ...shorthands.borderColor(
      `color-mix(in srgb, ${tokens.colorNeutralForeground1} 10%, transparent)`,
    ),
    transitionProperty: 'background-color, border-color',
    transitionDuration: durationVar('faster'),
    transitionTimingFunction: tokens.curveLinear,
    ':hover': {
      backgroundColor: `color-mix(in oklab, ${tokens.colorNeutralForeground1} 12%, transparent)`,
    },
    ':active': { backgroundColor: 'var(--bg-chip)' },
  },
});

interface AlbumDetailToolsProps {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly sort: TableSort | null;
  readonly onSort: (sort: TableSort | null) => void;
}

export function AlbumDetailTools({ query, onQuery, sort, onSort }: AlbumDetailToolsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const classes = useStyles();
  const [searchOpen, setSearchOpen] = useState(query !== '');
  const [sortOpen, setSortOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const sorting = useRef<HTMLDivElement>(null);
  const sortButton = useRef<HTMLButtonElement>(null);
  const focusSearch = useRef(false);
  const field = detailSortField(sort);
  const descending = sort?.descending ?? false;
  const label = (column: ColumnId) =>
    t(column === 'number' ? 'albumDetail.albumOrder' : columnDef(column).label);
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
    <div className={styles.root} style={motionStyle} data-detail-tools>
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
              placeholder={t('albumDetail.find')}
              aria-label={t('albumDetail.find')}
              dismiss={{ 'aria-label': t('query.clear') }}
              onChange={(_, data) => onQuery(data.value)}
              data-detail-find
            />
          </div>
          <div className={styles['search-trigger']} inert={finding} aria-hidden={finding}>
            <Tooltip content={t('albumDetail.find')} relationship="label">
              <Button
                ref={searchButton}
                appearance="subtle"
                shape="circular"
                className={classes.icon}
                icon={<Search16Regular />}
                aria-label={t('albumDetail.find')}
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
        <div ref={sorting} className={styles.sort}>
          <div className={styles['sort-trigger']}>
            <Tooltip content={t('albumDetail.sort')} relationship="label">
              <Button
                ref={sortButton}
                appearance="subtle"
                shape="circular"
                className={mergeClasses(
                  classes.icon,
                  sortOpen && classes.open,
                  !sortOpen && sort !== null && classes.active,
                )}
                icon={<ArrowSortDownLines16Regular />}
                aria-label={t('albumDetail.sort')}
                aria-expanded={sortOpen}
                data-detail-sort-toggle
                data-active={sort !== null || undefined}
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
                const next = DETAIL_SORT_FIELDS.find((value) => data.checkedItems.includes(value));
                if (next) onSort(detailSort(next, descending));
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
                  {DETAIL_SORT_FIELDS.map((column) => (
                    <MenuItemRadio key={column} name="field" value={column}>
                      {label(column)}
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
                onClick={() => onSort(detailSort(field, !descending))}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
