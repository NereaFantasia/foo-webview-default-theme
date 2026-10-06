import {
  Button,
  Spinner,
  makeStyles,
  tokens,
  useRestoreFocusTarget,
} from '@fluentui/react-components';
import { PanelLeft20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { createSnapshotSlot, historyAtom } from '../../nav/navHistory.ts';
import type { PageProps } from '../../nav/places.ts';
import { PageEntryContext, usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { emptySelection } from '../../kit/keyedSelection.ts';
import { useLibrarySplit } from '../split-view/useLibrarySplit.ts';
import { LibrarySplitHandle } from '../split-view/LibrarySplitHandle.tsx';
import { LibraryDrawer } from '../split-view/LibraryDrawer.tsx';
import type { TrackTableHandle } from '../../table/TrackTable.tsx';
import { albumsAtom } from '../albums.ts';
import { genresActionNoticeAtom } from './genresActions.ts';
import { genresCatalogAtom } from './genresCatalog.ts';
import { GenresDetail } from './GenresDetail.tsx';
import { GenresList } from './GenresList.tsx';
import { filterGenres } from './genresModel.ts';
import { genresPrefsAtom } from './genresPrefs.ts';
import { genresRowsAtom } from './genresRows.ts';
import { genreEntryOf } from './genresSubject.ts';
import styles from './GenresPage.module.css';
import { useService } from '../../kit/useService.ts';
import { genresKey } from './genresServices.ts';
import { AddFoldersAction } from '../AddFoldersAction.tsx';

interface GenresSnapshot {
  readonly text: string;
  readonly tidy: boolean;
  readonly listTop: number;
  readonly detailTop: number;
  readonly focus: string | null;
  readonly listFocus: string | null;
  readonly closed: ReadonlySet<string>;
}
const SLOT = createSnapshotSlot<GenresSnapshot>();
const useStyles = makeStyles({ notice: { color: tokens.colorPaletteRedForeground1 } });

export function GenresPage({ place }: PageProps) {
  const genres = useService(genresKey);
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom);
  const catalog = useAtomValueRawSync(genresCatalogAtom);
  const prefs = useAtomValueRawSync(genresPrefsAtom);
  const rows = useAtomValueRawSync(genresRowsAtom);
  const actionNotice = useAtomValueRawSync(genresActionNoticeAtom);
  const library = useAtomValueRawSync(albumsAtom);
  const classes = useStyles();
  const split = useLibrarySplit('genres');
  const drawerTrigger = useRestoreFocusTarget();
  const pageEntry = useContext(PageEntryContext);
  const history = useAtomValueRawSync(historyAtom);
  const active = pageEntry === null || pageEntry === history.entry;
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [text, setText] = useState('');
  const [tidy, setTidy] = useState(false);
  const [listFocus, setListFocus] = useState<string | null>(place.subject ?? null);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const list = useRef<HTMLDivElement>(null);
  const listTop = useRef(0);
  const listSelection = useRef(emptySelection<string>());
  const detail = useRef<HTMLDivElement>(null);
  const handle = useRef<TrackTableHandle>(null);
  const restore = useRef<GenresSnapshot | null>(null);
  const selected = place.subject ?? null;
  const previousSubject = useRef(selected);
  const entry = genreEntryOf(catalog.entries, selected);
  const entries = useMemo(
    () => filterGenres(catalog.entries, text, tidy, prefs.sort, prefs.descending, locale.active),
    [catalog.entries, text, tidy, prefs.sort, prefs.descending, locale.active],
  );
  useEffect(() => {
    genres.catalog.want();
  }, [genres]);
  useEffect(() => {
    if (!split.compact || !active) setDirectoryOpen(false);
  }, [split.compact, active]);
  useEffect(() => {
    if (previousSubject.current === selected) return;
    previousSubject.current = selected;
    if (!restore.current) setClosed(new Set());
  }, [selected]);
  usePageSnapshot(
    SLOT,
    {
      capture: () =>
        restore.current ?? {
          text,
          tidy,
          listTop: listTop.current,
          detailTop: detail.current?.scrollTop ?? 0,
          focus: handle.current?.focusedKey() ?? null,
          listFocus,
          closed,
        },
      restore: (saved) => {
        restore.current = saved;
        setText(saved.text);
        setTidy(saved.tidy);
        setListFocus(saved.listFocus);
        setClosed(saved.closed);
        listTop.current = saved.listTop;
      },
    },
    true,
  );
  useLayoutEffect(() => {
    const saved = restore.current;
    if (!saved || catalog.status !== 'ready' || text !== saved.text || tidy !== saved.tidy) return;
    if (list.current) list.current.scrollTop = saved.listTop;
    if (selected !== null && (rows.key !== selected || rows.status !== 'ready')) return;
    if (detail.current) detail.current.scrollTop = saved.detailTop;
    handle.current?.setFocusKey(saved.focus);
    restore.current = null;
  }, [catalog.status, selected, rows, text, tidy, closed]);
  const notice =
    actionNotice === 'busy'
      ? 'genres.busy'
      : actionNotice === 'unsupported'
        ? 'genres.unsupported'
        : actionNotice === 'gone'
          ? 'genres.gone'
          : 'genres.actionFailed';
  const navigator = (
    <GenresList
      entries={entries}
      selected={selected}
      focus={listFocus}
      onFocus={setListFocus}
      compact={split.compact}
      text={text}
      tidy={tidy}
      scroll={list}
      scrollTop={listTop}
      selection={listSelection}
      onText={setText}
      onTidy={setTidy}
      onSelect={() => setDirectoryOpen(false)}
    />
  );
  return (
    <section
      ref={split.measure}
      className={styles.root}
      aria-label={t('genres.title')}
      data-page="genres"
    >
      <header className={styles.header}>
        {split.compact && (
          <Button
            {...drawerTrigger}
            appearance="subtle"
            icon={<PanelLeft20Regular />}
            aria-expanded={directoryOpen}
            onClick={() => setDirectoryOpen(true)}
          >
            {t('genres.directory')}
          </Button>
        )}
        <h1>{t('genres.title')}</h1>
        <span>{t('genres.total', { count: catalog.entries.length })}</span>
      </header>
      {actionNotice && (
        <div role="alert" className={styles.notice}>
          <span className={classes.notice}>{t(notice)}</span>
          <Button size="small" onClick={genres.actions.dismiss}>
            {t('genres.dismiss')}
          </Button>
        </div>
      )}
      {catalog.status === 'failed' && (
        <div role="alert" className={styles.notice}>
          {t('genres.failed')}
          <Button size="small" onClick={() => void genres.catalog.retry()}>
            {t('genres.retry')}
          </Button>
        </div>
      )}
      {catalog.generation === 0 ? (
        <div className={styles.empty}>
          {catalog.status !== 'failed' && <Spinner label={t('genres.loading')} />}
        </div>
      ) : catalog.entries.length === 0 ? (
        <div className={styles.empty}>
          {t(library.enabled ? 'genres.empty' : 'album.disabledTitle')}
          <AddFoldersAction />
        </div>
      ) : (
        <div className={styles.body}>
          {!split.compact && (
            <>
              <div className={styles.browser} style={{ width: split.size }}>
                {navigator}
              </div>
              <LibrarySplitHandle split={split} label={t('genres.split')} />
            </>
          )}
          {entry ? (
            <GenresDetail
              key={entry.key}
              entry={entry}
              closed={closed}
              setClosed={setClosed}
              scroll={detail}
              handle={handle}
            />
          ) : (
            <div className={styles.empty}>
              {t(selected === null ? 'genres.pick' : 'genres.gone')}
            </div>
          )}
        </div>
      )}
      {split.compact && (
        <LibraryDrawer
          open={directoryOpen && active}
          title={t('genres.directory')}
          closeLabel={t('genres.closeDirectory')}
          onOpenChange={setDirectoryOpen}
        >
          {navigator}
        </LibraryDrawer>
      )}
    </section>
  );
}
