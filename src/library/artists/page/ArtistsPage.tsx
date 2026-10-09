import { Button, Spinner, useRestoreFocusTarget } from '@fluentui/react-components';
import { PanelLeft20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { createSnapshotSlot, historyAtom } from '../../../nav/navHistory.ts';
import { PageEntryContext, usePageSnapshot } from '../../../nav/usePageSnapshot.ts';
import { emptySelection } from '../../../kit/keyedSelection.ts';
import { useLibrarySplit } from '../../split-view/useLibrarySplit.ts';
import { LibrarySplitHandle } from '../../split-view/LibrarySplitHandle.tsx';
import { LibraryDrawer } from '../../split-view/LibraryDrawer.tsx';
import { ArtistsContext, useArtists } from '../artistsContext.ts';
import { ArtistsList } from './ArtistsList.tsx';
import { ArtistHeader } from './ArtistHeader.tsx';
import { ArtistAbout } from './ArtistAbout.tsx';
import { ArtistHighlights } from './ArtistHighlights.tsx';
import { ArtistAlbums } from './ArtistAlbums.tsx';
import { ArtistMenu } from './ArtistMenu.tsx';
import { ArtistRenameDialog } from './ArtistRenameDialog.tsx';
import styles from './ArtistsPage.module.css';
import { AddFoldersAction } from '../../AddFoldersAction.tsx';

interface ArtistsSnapshot {
  readonly text: string;
  readonly tidy: boolean;
  readonly focus: string | null;
  readonly listTop: number;
  readonly detailTop: number;
}
const SLOT = createSnapshotSlot<ArtistsSnapshot>();

interface ArtistMenuState {
  readonly names: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly inDrawer: boolean;
}

interface ArtistRenameState {
  readonly names: readonly string[];
  readonly target: string;
  readonly inDrawer: boolean;
}

function ArtistsContent() {
  const services = useArtists();
  const t = useAtomValueRawSync(translateAtom);
  const catalog = useAtomValueRawSync(services.catalog.state);
  const all = useAtomValueRawSync(services.catalog.all);
  const subject = useAtomValueRawSync(services.places.selected);
  const temporary = useAtomValueRawSync(services.places.temporary);
  const detail = useAtomValueRawSync(services.detail.state);
  const failed = useAtomValueRawSync(services.actions.failed);
  const split = useLibrarySplit('artists');
  const drawerTrigger = useRestoreFocusTarget();
  const entry = useContext(PageEntryContext);
  const history = useAtomValueRawSync(historyAtom);
  const active = entry === null || entry === history.entry;
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [text, setText] = useState('');
  const [tidy, setTidy] = useState(false);
  const [focus, setFocus] = useState<string | null>(subject);
  const [menu, setMenu] = useState<ArtistMenuState | null>(null);
  const [rename, setRename] = useState<ArtistRenameState | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const listTop = useRef(0);
  const listSelection = useRef(emptySelection<string>());
  const scroll = useRef<HTMLDivElement>(null);
  const restoring = useRef<ArtistsSnapshot | null>(null);
  const previous = useRef(subject);
  useEffect(() => {
    if (!split.compact || !active) setDirectoryOpen(false);
  }, [split.compact, active]);
  useEffect(() => {
    if (!directoryOpen || !split.compact || !active) {
      setMenu((current) => (current?.inDrawer ? null : current));
    }
  }, [directoryOpen, split.compact, active]);
  useEffect(() => {
    if (subject === previous.current) return;
    previous.current = subject;
    if (!restoring.current) {
      if (scroll.current) scroll.current.scrollTop = 0;
    }
  }, [subject]);
  usePageSnapshot(
    SLOT,
    {
      capture: () =>
        restoring.current ?? {
          text,
          tidy,
          focus,
          listTop: listTop.current,
          detailTop: scroll.current?.scrollTop ?? 0,
        },
      restore: (saved) => {
        restoring.current = saved;
        setText(saved.text);
        setTidy(saved.tidy);
        setFocus(saved.focus);
        listTop.current = saved.listTop;
      },
    },
    true,
  );
  useLayoutEffect(() => {
    const saved = restoring.current;
    if (!saved || !catalog.loaded || text !== saved.text || tidy !== saved.tidy) return;
    if (list.current) list.current.scrollTop = saved.listTop;
    if (subject !== null && (detail.subject !== subject || detail.status !== 'ready')) return;
    if (scroll.current) scroll.current.scrollTop = saved.detailTop;
    restoring.current = null;
  }, [catalog.loaded, detail, subject, text, tidy]);
  const selected = all.find((row) => row.name === subject);
  const openMenu = (names: readonly string[], x: number, y: number, inDrawer = false) => {
    setMenu({ names, x, y, inDrawer });
  };
  const contextMenu = menu && (
    <ArtistMenu
      names={menu.names}
      at={menu}
      onClose={() => setMenu(null)}
      onAbout={() => {
        scroll.current?.querySelector('[data-artist-about]')?.scrollIntoView({ block: 'start' });
      }}
      onRename={(names, target) => setRename({ names, target, inDrawer: menu.inDrawer })}
    />
  );
  const renameDialog = rename && <ArtistRenameDialog {...rename} onClose={() => setRename(null)} />;
  const navigator = (
    <ArtistsList
      text={text}
      tidy={tidy}
      focus={focus}
      compact={split.compact}
      scroll={list}
      scrollTop={listTop}
      selection={listSelection}
      commands={services.commands}
      onText={setText}
      onTidy={setTidy}
      onFocus={setFocus}
      onMenu={(names, x, y) => openMenu(names, x, y, split.compact)}
      onSelect={() => setDirectoryOpen(false)}
    />
  );
  return (
    <section
      ref={split.measure}
      className={styles.root}
      data-page="artists"
      aria-label={t('artists.title')}
    >
      {split.compact && (
        <header className={styles.toolbar}>
          <Button
            {...drawerTrigger}
            appearance="subtle"
            icon={<PanelLeft20Regular />}
            aria-expanded={directoryOpen}
            onClick={() => setDirectoryOpen(true)}
          >
            {t('artists.directory')}
          </Button>
        </header>
      )}
      {(catalog.status === 'failed' || catalog.truncated || failed) && (
        <div className={styles.notice} role="alert">
          {t(
            failed
              ? 'artists.failedAction'
              : catalog.truncated
                ? 'artists.truncated'
                : 'artists.failed',
          )}
          <Button onClick={services.retry}>{t('artists.retry')}</Button>
        </div>
      )}
      {temporary && (
        <div className={styles.notice} role="status">
          {t('artists.temporary')}
          <Button size="small" onClick={services.places.resetTemporary}>
            {t('artists.reset')}
          </Button>
        </div>
      )}
      {!catalog.loaded && catalog.status !== 'failed' ? (
        <Spinner aria-label={t('artists.loading')} />
      ) : catalog.loaded && !all.length ? (
        <div className={styles.empty}>
          {t('artists.empty')}
          <AddFoldersAction />
        </div>
      ) : (
        <div className={styles.body}>
          {!split.compact && (
            <>
              <div className={styles.browser} style={{ width: split.size }}>
                {navigator}
              </div>
              <LibrarySplitHandle split={split} label={t('artists.split')} />
            </>
          )}
          {selected ? (
            <div className={styles.detail} ref={scroll}>
              <ArtistHeader
                key={`header:${subject}`}
                onMenu={(x, y) => {
                  if (subject !== null) openMenu([subject], x, y);
                }}
              />
              <ArtistAbout />
              <ArtistHighlights key={`highlights:${subject}`} />
              <ArtistAlbums />
            </div>
          ) : (
            <div className={styles.empty}>
              {t(subject === null ? 'artists.pick' : 'artists.gone')}
            </div>
          )}
        </div>
      )}
      {split.compact && (
        <LibraryDrawer
          open={directoryOpen && active}
          title={t('artists.directory')}
          closeLabel={t('artists.closeDirectory')}
          onOpenChange={(open) => {
            if (open || !rename?.inDrawer) setDirectoryOpen(open);
          }}
        >
          {navigator}
          {menu?.inDrawer && contextMenu}
        </LibraryDrawer>
      )}
      {!menu?.inDrawer && contextMenu}
      {renameDialog}
    </section>
  );
}

export function ArtistsPage() {
  const services = useContext(ArtistsContext);
  return services ? <ArtistsContent /> : <Spinner />;
}

export const ARTISTS_PAGES = { artists: ArtistsPage };
