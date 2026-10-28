import { mergeClasses, Button, makeStyles, tokens } from '@fluentui/react-components';
import {
  MoreHorizontal20Regular,
  RecordRegular,
  MicRegular,
  TextNumberListLtr16Regular,
} from '@fluentui/react-icons';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { pluralAtom } from '../../../i18n/plural.ts';
import { Metadata, MetadataItem } from '../../../kit/Metadata.tsx';
import type { CommandRegistry } from '../../../nav/commandRegistry.ts';
import type { KeyedSelection } from '../../../kit/keyedSelection.ts';
import { useArtists } from '../artistsContext.ts';
import { filterArtists } from '../artistCatalog.ts';
import { isCompilation } from '../artistNames.ts';
import { useArtistList } from './useArtistList.ts';
import styles from './ArtistsList.module.css';
import { ArtistListTools } from './ArtistListTools.tsx';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';

const useStyles = makeStyles({
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
  const plural = useAtomValueRawSync(pluralAtom);
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
        <Metadata>
          <MetadataItem icon={<MicRegular />} label={t('trackInfo.artist')}>
            {t('artists.total', { count: catalog.rows.length })}
          </MetadataItem>
        </Metadata>
      </header>
      <ArtistListTools
        text={props.text}
        tidy={props.tidy}
        onText={props.onText}
        onTidy={props.onTidy}
      />
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
                  <Metadata className={styles.count}>
                    <MetadataItem icon={<RecordRegular />} label={t('trackInfo.album')}>
                      {t(plural(row.albumCount, 'album.countOne', 'album.count'), {
                        count: row.albumCount,
                      })}
                    </MetadataItem>
                    <MetadataItem icon={<TextNumberListLtr16Regular />}>
                      {t(plural(row.trackCount, 'album.menuTracksOne', 'album.menuTracks'), {
                        count: row.trackCount,
                      })}
                    </MetadataItem>
                  </Metadata>
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
