import {
  Button,
  Input,
  Dropdown,
  Option,
  Tab,
  TabList,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ChevronRight20Regular,
  MoreHorizontal20Regular,
  Play20Regular,
  Add20Regular,
} from '@fluentui/react-icons';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type { KeyedSelection } from '../../kit/keyedSelection.ts';
import { EMPTY_GENRE, genresQuery, type GenreEntry } from './genresModel.ts';
import { genresPrefsAtom } from './genresPrefs.ts';
import { GenresMenu } from './GenresMenu.tsx';
import { useGenresList } from './useGenresList.ts';
import styles from './GenresList.module.css';
import { useService } from '../../kit/useService.ts';
import { genresKey } from './genresServices.ts';

const useStyles = makeStyles({
  input: { width: '100%' },
  tabs: { padding: 0 },
  sort: { minWidth: 0, flex: 1 },
  action: { minWidth: '28px', padding: tokens.spacingHorizontalXXS },
});
export interface GenresListProps {
  readonly entries: readonly GenreEntry[];
  readonly selected: string | null;
  readonly focus: string | null;
  readonly onFocus: (key: string | null) => void;
  readonly compact: boolean;
  readonly text: string;
  readonly tidy: boolean;
  readonly scroll: RefObject<HTMLDivElement | null>;
  readonly scrollTop: RefObject<number>;
  readonly selection: RefObject<KeyedSelection<string>>;
  readonly onText: (text: string) => void;
  readonly onTidy: (tidy: boolean) => void;
  readonly onSelect: () => void;
}

export function GenresList(props: GenresListProps) {
  const genres = useService(genresKey);
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(genresPrefsAtom);
  const classes = useStyles();
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const [menu, setMenu] = useState<{ keys: readonly string[]; x: number; y: number } | null>(null);
  const select = (key: string) => {
    genres.places.select(key);
    props.onSelect();
  };
  const list = useGenresList(
    props.entries,
    props.focus,
    root,
    props.onFocus,
    (key) => {
      if (!props.compact) genres.places.select(key);
    },
    select,
    (keys, x, y) => setMenu({ keys, x, y }),
    menu !== null,
    props.selection,
  );
  const virtual = useVirtualizer({
    count: props.entries.length,
    getScrollElement: () => props.scroll.current,
    estimateSize: () => 52,
    overscan: 5,
    getItemKey: (index) => props.entries[index]?.key ?? index,
    initialOffset: () => props.scrollTop.current,
  });
  const focusedIndex = props.entries.findIndex((entry) => entry.key === list.focus);
  const previousFocus = useRef(list.focus);
  useEffect(() => {
    if (previousFocus.current === list.focus) return;
    previousFocus.current = list.focus;
    if (focusedIndex >= 0) virtual.scrollToIndex(focusedIndex, { align: 'auto' });
  }, [focusedIndex, list.focus, virtual]);
  useLayoutEffect(() => {
    const element = props.scroll.current;
    if (element) element.scrollTop = props.scrollTop.current;
  }, [props.scroll, props.scrollTop]);
  const open = (entry: GenreEntry, ctrl: boolean, shift: boolean) => {
    root.current?.focus({ preventScroll: true });
    list.select(entry.key, { ctrl, shift });
    if (props.compact && !ctrl && !shift) select(entry.key);
  };
  return (
    <aside
      className={styles.root}
      data-compact={props.compact || undefined}
      aria-label={t('genres.title')}
    >
      <div className={styles.tools}>
        <Input
          className={classes.input}
          value={props.text}
          onChange={(_, data) => props.onText(data.value)}
          placeholder={t('genres.filter')}
          aria-label={t('genres.filter')}
        />
        <TabList
          className={classes.tabs}
          size="small"
          selectedValue={props.tidy ? 'tidy' : 'all'}
          onTabSelect={(_, data) => props.onTidy(data.value === 'tidy')}
        >
          <Tab value="all">{t('genres.all')}</Tab>
          <Tab value="tidy">{t('genres.tidy')}</Tab>
        </TabList>
        <div className={styles.sort}>
          <Dropdown
            className={classes.sort}
            size="small"
            value={t(`genres.sort.${prefs.sort}`)}
            selectedOptions={[prefs.sort]}
            aria-label={t('genres.sort')}
            onOptionSelect={(_, data) => {
              const sort = data.optionValue;
              if (sort === 'name' || sort === 'tracks' || sort === 'albums')
                genres.prefs.update({ sort });
            }}
          >
            <Option value="name">{t('genres.sort.name')}</Option>
            <Option value="tracks">{t('genres.sort.tracks')}</Option>
            <Option value="albums">{t('genres.sort.albums')}</Option>
          </Dropdown>
          <Button
            size="small"
            appearance={prefs.descending ? 'primary' : 'subtle'}
            aria-pressed={prefs.descending}
            onClick={() => genres.prefs.update({ descending: !prefs.descending })}
          >
            {t('genres.descending')}
          </Button>
        </div>
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
          aria-label={t('genres.title')}
          aria-multiselectable
          aria-rowcount={props.entries.length}
          aria-colcount={2}
          aria-activedescendant={focusedIndex < 0 ? undefined : `${id}-${focusedIndex}`}
          style={{ height: virtual.getTotalSize() }}
          className={styles.rows}
        >
          {virtual.getVirtualItems().map((item) => {
            const entry = props.entries[item.index];
            if (!entry) return null;
            const name = entry.key === EMPTY_GENRE ? t('genres.unknown') : entry.key;
            const disabled = genresQuery([entry.key]) === null;
            return (
              <div
                key={item.key}
                id={`${id}-${item.index}`}
                role="row"
                aria-rowindex={item.index + 1}
                aria-selected={list.selection.selected.has(entry.key)}
                className={styles.row}
                data-focused={list.focus === entry.key || undefined}
                data-current={props.selected === entry.key || undefined}
                data-genre-name={name}
                style={{ transform: `translateY(${item.start}px)` }}
                onClick={(event) => open(entry, event.ctrlKey || event.metaKey, event.shiftKey)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  list.openMenu(entry.key, event.clientX, event.clientY);
                }}
              >
                <div role="gridcell" className={styles.text}>
                  <span className={styles.name} title={name}>
                    {name}
                  </span>
                  <span className={styles.count}>
                    {entry.issue && props.tidy
                      ? t(`genres.${entry.issue}`)
                      : t('genres.counts', {
                          albums: entry.albumCount,
                          tracks: entry.tracks.length,
                        })}
                  </span>
                </div>
                <div
                  role="gridcell"
                  className={styles.actions}
                  onClick={(event) => event.stopPropagation()}
                >
                  {props.compact ? (
                    <Button
                      appearance="subtle"
                      tabIndex={-1}
                      icon={<ChevronRight20Regular />}
                      aria-label={name}
                      onClick={() => select(entry.key)}
                    />
                  ) : (
                    <>
                      <Button
                        className={classes.action}
                        appearance="subtle"
                        tabIndex={-1}
                        disabled={disabled}
                        icon={<Play20Regular />}
                        aria-label={t('genres.play')}
                        onClick={() => void genres.actions.play([entry.key], name)}
                      />
                      <Button
                        className={classes.action}
                        appearance="subtle"
                        tabIndex={-1}
                        disabled={disabled}
                        icon={<Add20Regular />}
                        aria-label={t('genres.autoplaylist')}
                        onClick={() => void genres.actions.send([entry.key], name, true)}
                      />
                      <Button
                        className={classes.action}
                        appearance="subtle"
                        tabIndex={-1}
                        icon={<MoreHorizontal20Regular />}
                        aria-label={t('genres.more')}
                        onClick={(event) => list.openMenu(entry.key, event.clientX, event.clientY)}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {props.entries.length === 0 && (
          <p className={styles.empty}>{t(props.tidy ? 'genres.noIssues' : 'genres.noMatch')}</p>
        )}
      </div>
      {menu && <GenresMenu keys={menu.keys} at={menu} onClose={() => setMenu(null)} />}
    </aside>
  );
}
