import {
  mergeClasses,
  Button,
  Input,
  Menu,
  MenuDivider,
  MenuItemCheckbox,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tab,
  TabList,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ChevronDown16Regular,
  Filter16Regular,
  MoreHorizontal20Regular,
} from '@fluentui/react-icons';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import type { CommandRegistry } from '../../../nav/commandRegistry.ts';
import type { KeyedSelection } from '../../../kit/keyedSelection.ts';
import { useArtists } from '../artistsContext.ts';
import { filterArtists } from '../artistCatalog.ts';
import { isCompilation } from '../artistNames.ts';
import { useArtistList } from './useArtistList.ts';
import styles from './ArtistsList.module.css';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';

const useStyles = makeStyles({
  input: { minWidth: 0, flex: 1 },
  tabs: { padding: 0 },
  action: { minWidth: '28px', padding: tokens.spacingHorizontalXXS },
});
export interface ArtistsListProps {
  readonly text: string;
  readonly tidy: boolean;
  readonly focus: string | null;
  readonly compact: boolean;
  readonly scroll: RefObject<HTMLDivElement | null>;
  readonly scrollTop: RefObject<number>;
  readonly selection: RefObject<KeyedSelection<string>>;
  readonly commands: CommandRegistry;
  onText(value: string): void;
  onTidy(value: boolean): void;
  onFocus(value: string): void;
  onMenu(names: readonly string[], x: number, y: number): void;
  onSelect(): void;
}

export function ArtistsList(props: ArtistsListProps) {
  const controls = useViewControlStyles();
  const services = useArtists();
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const catalog = useAtomValueRawSync(services.catalog.state);
  const prefs = useAtomValueRawSync(services.prefs.state);
  const selected = useAtomValueRawSync(services.places.selected);
  const marked = useAtomValueRawSync(services.tidy.compilations);
  const classes = useStyles();
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const rows = useMemo(
    () =>
      filterArtists(
        catalog.rows,
        props.text,
        prefs,
        locale,
        props.tidy ? catalog.issues : undefined,
      ),
    [catalog, props.text, props.tidy, prefs, locale],
  );
  const order = useMemo(() => rows.map((row) => row.name), [rows]);
  const select = (name: string) => {
    services.places.select(name);
    props.onSelect();
  };
  const list = useArtistList(
    order,
    props.focus,
    root,
    (name) => {
      props.onFocus(name);
      if (!props.compact) services.places.select(name);
    },
    () => {
      if (props.compact && props.focus !== null) select(props.focus);
      else void services.play();
    },
    props.onMenu,
    props.commands,
    props.selection,
  );
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => props.scroll.current,
    estimateSize: () => 44,
    overscan: 6,
    getItemKey: (at) => rows[at]?.name ?? at,
    initialOffset: () => props.scrollTop.current,
  });
  const focused = order.indexOf(props.focus ?? '');
  const previousFocus = useRef(props.focus);
  useEffect(() => {
    if (previousFocus.current === props.focus) return;
    previousFocus.current = props.focus;
    if (focused >= 0) virtual.scrollToIndex(focused, { align: 'auto' });
  }, [focused, props.focus, virtual]);
  useLayoutEffect(() => {
    const element = props.scroll.current;
    if (element) element.scrollTop = props.scrollTop.current;
  }, [props.scroll, props.scrollTop]);
  return (
    <aside
      className={styles.root}
      aria-label={t('artists.title')}
      data-compact={props.compact || undefined}
    >
      <header className={styles.heading}>
        {!props.compact && <h1>{t('artists.title')}</h1>}
        <span>
          {t('artists.total', { count: catalog.rows.length })} · {t(`artists.${catalog.basis}`)}
        </span>
      </header>
      <div className={styles.tools}>
        <div className={styles.filter}>
          <Input
            className={mergeClasses(classes.input, controls.field)}
            contentBefore={<Filter16Regular />}
            value={props.text}
            aria-label={t('artists.filter')}
            placeholder={t('artists.filter')}
            onChange={(_, data) => props.onText(data.value)}
          />
          <Menu
            checkedValues={{
              basis: [prefs.basis],
              sort: [prefs.sort],
              descending: prefs.descending ? ['yes'] : [],
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <Button
                className={controls.field}
                aria-label={t('artists.sort')}
                icon={<ChevronDown16Regular />}
                iconPosition="after"
              >
                {t(`artists.${prefs.sort}`)}
              </Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {(['albumArtist', 'credited'] as const).map((basis) => (
                  <MenuItemRadio
                    key={basis}
                    name="basis"
                    value={basis}
                    onClick={() => services.prefs.update({ basis })}
                  >
                    {t(`artists.${basis}`)}
                  </MenuItemRadio>
                ))}
                <MenuDivider />
                {(['name', 'albums', 'tracks'] as const).map((sort) => (
                  <MenuItemRadio
                    key={sort}
                    name="sort"
                    value={sort}
                    onClick={() => services.prefs.update({ sort })}
                  >
                    {t(`artists.${sort}`)}
                  </MenuItemRadio>
                ))}
                <MenuDivider />
                <MenuItemCheckbox
                  name="descending"
                  value="yes"
                  onClick={() => services.prefs.update({ descending: !prefs.descending })}
                >
                  {t('artists.descending')}
                </MenuItemCheckbox>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
        <TabList
          className={classes.tabs}
          size="small"
          selectedValue={props.tidy ? 'tidy' : 'all'}
          onTabSelect={(_, data) => props.onTidy(data.value === 'tidy')}
        >
          <Tab value="all">{t('artists.all', { count: catalog.rows.length })}</Tab>
          <Tab value="tidy">{t('artists.tidy', { count: catalog.issues.size })}</Tab>
        </TabList>
      </div>
      <div
        ref={props.scroll}
        className={styles.scroll}
        onScroll={(event) => {
          props.scrollTop.current = event.currentTarget.scrollTop;
        }}
      >
        <div
          ref={root}
          role="grid"
          tabIndex={0}
          aria-label={t('artists.title')}
          aria-multiselectable
          aria-rowcount={rows.length}
          aria-colcount={2}
          aria-activedescendant={focused < 0 ? undefined : `${id}-${focused}`}
          className={styles.rows}
          style={{ height: virtual.getTotalSize() }}
        >
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const issue = catalog.issues.get(row.name)?.[0];
            const name = row.name || t('artists.unknown');
            return (
              <div
                key={item.key}
                id={`${id}-${item.index}`}
                role="row"
                aria-rowindex={item.index + 1}
                aria-selected={list.selection.selected.has(row.name)}
                data-current={selected === row.name || undefined}
                data-focused={props.focus === row.name || undefined}
                data-artist={row.name}
                className={styles.row}
                style={{ transform: `translateY(${item.start}px)` }}
                onClick={(event) => {
                  root.current?.focus({ preventScroll: true });
                  list.select(row.name, {
                    ctrl: event.ctrlKey || event.metaKey,
                    shift: event.shiftKey,
                  });
                  if (props.compact && !event.ctrlKey && !event.metaKey && !event.shiftKey)
                    select(row.name);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  list.openMenu(row.name, event.clientX, event.clientY);
                }}
              >
                <div role="gridcell" className={styles.text}>
                  <span className={styles.name} title={name}>
                    {name}
                    {isCompilation(row.name, marked) && <small>{t('artists.compilation')}</small>}
                  </span>
                  {issue && (
                    <span className={styles.issue}>
                      {issue.kind === 'duplicate'
                        ? t('artists.duplicate', { name: issue.others[0] ?? '' })
                        : t('artists.multiple')}
                    </span>
                  )}
                </div>
                <div role="gridcell" className={styles.end}>
                  <span className={styles.count}>
                    {t('artists.counts', { albums: row.albumCount, tracks: row.trackCount })}
                  </span>
                  <span className={styles.actions}>
                    <Button
                      className={mergeClasses(classes.action, controls.icon)}
                      appearance="subtle"
                      icon={<MoreHorizontal20Regular />}
                      tabIndex={-1}
                      aria-label={t('artists.more')}
                      onClick={(event) => {
                        event.stopPropagation();
                        list.openMenu(row.name, event.clientX, event.clientY);
                      }}
                    />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {!rows.length && (
          <p className={styles.empty}>{t(props.tidy ? 'artists.noIssues' : 'artists.noMatch')}</p>
        )}
      </div>
    </aside>
  );
}
