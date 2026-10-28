import {
  Button,
  inputClassNames,
  Link,
  makeStyles,
  Portal,
  Spinner,
  tokens,
  Tooltip,
} from '@fluentui/react-components';
import { ArrowRight16Regular, Delete16Regular, Dismiss16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { objectOpenerKey } from '../../nav/objectOpener.ts';
import { SIDEBAR_COMPANION_ATTR } from '../../nav/sidebar/SidebarKey.tsx';
import { useCommand } from '../../nav/useCommand.ts';
import { useLightDismiss } from '../../nav/useLightDismiss.ts';
import { SEARCH_TAB_KEYS, useSearchSession } from './searchContext.ts';
import { SearchFeedback } from './SearchFeedback.tsx';
import { SearchInput } from './SearchInput.tsx';
import { SearchResultRow } from './SearchResultRow.tsx';
import { searchOptionId } from './searchSuggestions.ts';
import { useSearchFlyoutMotion } from './useSearchFlyoutMotion.ts';
import styles from './SearchFlyout.module.css';
import { useService } from '../../kit/useService.ts';
import { searchKey } from './searchServices.ts';
import { SegmentedTabs } from '../../kit/SegmentedTabs.tsx';
import { OnlineSuggestionRow } from './online/OnlineItems.tsx';
import { OnlineTrackMenu } from './online/OnlineTrackMenu.tsx';
import { SearchResultMenu } from './menus/SearchResultMenu.tsx';
import { platformName } from '../../playback/musicPlatforms.ts';
import { musicStatusKey } from '../../playback/musicStatus.ts';
import type { MessageKey } from '../../i18n/en.ts';
import type { MusicTrack } from '../../server/musicObjects.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import type { SearchHit } from './searchQuery.ts';

const MAX_WIDTH = 420;
// 节头是小号加粗的灰字，链接只取字号、不取字重
const useStyles = makeStyles({ more: { fontWeight: tokens.fontWeightRegular } });

export function SearchFlyout() {
  const session = useSearchSession();
  const search = useService(searchKey);
  const classes = useStyles();
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const recent = useAtomValueRawSync(search.recent.state);
  const preview = useAtomValueRawSync(search.preview.state);
  const albums = useAtomValueRawSync(search.preview.albums);
  const notice = useAtomValueRawSync(useService(objectOpenerKey).notice);
  const playNotice = useAtomValueRawSync(search.notice);
  const musicStatus = useService(musicStatusKey);
  const online = useAtomValueRawSync(search.onlinePreview.kinds.track);
  const onlinePlatform = platformName(t, useAtomValueRawSync(search.onlinePreview.platform));
  const menuFailed = useAtomValueRawSync(search.previewMenu.notice);
  // 本地行与在线行的右键菜单各一份，同一时刻只开一个；菜单在浮层的组件树里，点它不算点在外面
  const [menuAt, setMenuAt] = useState<TablePoint | null>(null);
  const [onlineMenu, setOnlineMenu] = useState<{
    readonly at: TablePoint;
    readonly tracks: readonly MusicTrack[];
  } | null>(null);
  const [queueNotice, setQueueNotice] = useState<MessageKey | null>(null);
  const openMenu = (hit: SearchHit, at: TablePoint) => {
    setOnlineMenu(null);
    void search.previewMenu.open(hit);
    setMenuAt(at);
  };
  const openOnlineMenu = (track: MusicTrack, at: TablePoint) => {
    search.previewMenu.close();
    setMenuAt(null);
    setOnlineMenu({ at, tracks: [track] });
  };
  const onlineScope = session.scope === 'online';
  const draft = session.draft.trim();
  const { panel, present } = useSearchFlyoutMotion(session.open);
  const [box, setBox] = useState({ left: 8, top: 40, width: MAX_WIDTH, maxHeight: 500 });
  const markInside = useLightDismiss({
    id: 'search.dismiss',
    open: session.open,
    panel,
    exempt: (target) => !!target.closest('[data-search-input], [data-search-trigger]'),
    onDismiss: (escape) => session.close(escape),
  });
  useCommand({
    id: 'search.returnToInput',
    layer: 'overlay',
    keys: [{ key: 'Tab', shift: true }],
    enabled: () =>
      session.open &&
      session.mode === 'sidebar' &&
      document.activeElement === panel.current?.querySelector('button:not(:disabled)'),
    run: () => session.anchor?.focus(),
  });
  useLayoutEffect(() => {
    if (!session.open) return;
    const anchor =
      session.mode === 'sidebar'
        ? (session.anchor?.closest(`.${inputClassNames.root}`) ?? session.anchor)
        : session.anchor;
    const measure = () => {
      const rect = anchor?.getBoundingClientRect();
      const width = Math.min(MAX_WIDTH, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - width - 8));
      const top = Math.max(
        8,
        Math.min(
          session.mode === 'sidebar' ? (rect?.bottom ?? 40) + 4 : (rect?.top ?? 40),
          Math.max(8, window.innerHeight - 240),
        ),
      );
      setBox({ left, top, width, maxHeight: Math.max(100, window.innerHeight - top - 96) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (anchor) observer.observe(anchor);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [session.open, session.anchor, session.mode]);
  useLayoutEffect(() => {
    if (session.active)
      document.getElementById(searchOptionId(session.active))?.scrollIntoView({ block: 'nearest' });
  }, [session.active]);
  if (!present) return null;
  return (
    <Portal>
      <div
        ref={panel}
        {...SEARCH_TAB_KEYS}
        {...(session.mode === 'sidebar' ? { [SIDEBAR_COMPANION_ATTR]: '' } : undefined)}
        style={box}
        className={styles.root}
        data-search-flyout
        inert={!session.open}
        aria-hidden={!session.open || undefined}
        onPointerDownCapture={markInside}
        onBlurCapture={(event) => {
          const next = event.relatedTarget;
          // 右键菜单经 Portal 挂在外面，焦点进菜单不算离开下拉
          if (
            next instanceof Element &&
            !event.currentTarget.contains(next) &&
            !next.closest('[data-search-input], [data-context-menu-owner]')
          )
            session.close();
        }}
        aria-label={t('search.suggestions')}
      >
        {session.mode === 'flyout' && (
          <div className={styles.input}>
            <SearchInput mode="flyout" />
          </div>
        )}
        <div className={styles.scope}>
          <SegmentedTabs
            label={t('online.scope')}
            value={session.scope}
            options={[
              { value: 'library', label: t('online.scopeLibrary') },
              { value: 'online', label: t('online.scopeOnline') },
            ]}
            onChange={(scope) => session.setScope(scope)}
            nativeTabOrder
          />
        </div>
        {!session.draft.trim() && (
          <div className={styles.heading}>
            <span>{t('search.recent')}</span>
            <Tooltip content={t('search.clearHistory')} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={<Delete16Regular />}
                disabled={!recent.items.length}
                aria-label={t('search.clearHistory')}
                onClick={() => {
                  search.recent.clear();
                  session.show('');
                }}
              />
            </Tooltip>
          </div>
        )}
        <div className={styles.scroller}>
          <div
            id="global-search-suggestions"
            role="listbox"
            aria-label={t('search.suggestions')}
            aria-busy={preview.status === 'loading'}
          >
            {(['recent', 'best', 'albums', 'tracks', 'online'] as const).map((group) => {
              const rows = session.suggestions.filter((row) => row.group === group);
              if (!rows.length) return null;
              const label = t(`search.${group === 'online' ? 'tracks' : group}`);
              return (
                <div key={group} role="group" aria-label={label}>
                  {group !== 'recent' && (
                    <div className={styles.heading}>
                      {label}
                      {group === 'online' && (
                        <Link
                          className={classes.more}
                          onClick={() =>
                            session.submit(session.draft, { scope: 'online', category: 'tracks' })
                          }
                        >
                          {t('search.viewAll')}
                        </Link>
                      )}
                      {group === 'albums' && (
                        <Link
                          className={classes.more}
                          onClick={() =>
                            session.submit(session.draft, { scope: 'library', category: 'albums' })
                          }
                        >
                          {t(plural(albums.length, 'search.viewAlbumsOne', 'search.viewAlbums'), {
                            count: albums.length,
                          })}
                        </Link>
                      )}
                      {group === 'tracks' && preview.total !== null && (
                        <Link
                          className={classes.more}
                          onClick={() =>
                            session.submit(session.draft, { scope: 'library', category: 'tracks' })
                          }
                        >
                          {t(plural(preview.total, 'search.viewTracksOne', 'search.viewTracks'), {
                            count: preview.total,
                          })}
                        </Link>
                      )}
                    </div>
                  )}
                  {rows.map((row) =>
                    row.online ? (
                      <OnlineSuggestionRow
                        key={row.key}
                        track={row.online}
                        id={searchOptionId(row.key)}
                        selected={session.active === row.key}
                        onOpen={() => {
                          session.select(row.key);
                          session.submit(session.draft, {
                            scope: 'online',
                            category: 'tracks',
                            focus: row.online?.ref.id,
                          });
                        }}
                        onMenu={(at) => {
                          session.select(row.key);
                          if (row.online) openOnlineMenu(row.online, at);
                        }}
                      />
                    ) : row.hit ? (
                      <SearchResultRow
                        key={row.key}
                        hit={row.hit}
                        id={searchOptionId(row.key)}
                        option
                        selected={session.active === row.key}
                        onOpen={() => {
                          session.select(row.key);
                          if (row.hit) session.activate(row.hit, session.draft);
                        }}
                        onMenu={(hit, at) => {
                          session.select(row.key);
                          openMenu(hit, at);
                        }}
                      />
                    ) : (
                      <div key={row.key} className={styles.history}>
                        <div
                          role="option"
                          id={searchOptionId(row.key)}
                          aria-selected={session.active === row.key}
                          className={styles.word}
                          data-selected={session.active === row.key || undefined}
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => session.accept(row)}
                        >
                          {row.text}
                        </div>
                        <Tooltip
                          content={t('search.removeHistory', { text: row.text ?? '' })}
                          relationship="label"
                        >
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={<Dismiss16Regular />}
                            aria-label={t('search.removeHistory', { text: row.text ?? '' })}
                            onClick={() => {
                              search.recent.remove(row.text ?? '');
                              session.show('');
                            }}
                          />
                        </Tooltip>
                      </div>
                    ),
                  )}
                </div>
              );
            })}
          </div>
          {!onlineScope && <SearchFeedback results={search.preview} />}
          {onlineScope && !!draft && (
            <div className={styles.notice} role="status">
              {(online.status === 'idle' || online.status === 'loading') && (
                <Spinner size="tiny" label={t('album.loading')} />
              )}
              {/* 三种失败同一个写法：先说发生了什么，再给一个能做的操作。 */}
              {online.status === 'failed' &&
                (online.failure === 'not-installed' ? (
                  <>
                    {t('online.setupTitle')}{' '}
                    {/* 进结果页的在线音乐范围：那里的空态写体积与许可，确认后才下载 */}
                    <Button
                      size="small"
                      onClick={() => session.submit(draft, { scope: 'online', category: 'all' })}
                    >
                      {t('online.downloadMore')}
                    </Button>
                  </>
                ) : (
                  <>
                    {t(
                      online.failure === 'backend-unavailable'
                        ? 'online.unavailableTitle'
                        : 'online.searchFailed',
                      { platform: onlinePlatform },
                    )}{' '}
                    <Button
                      size="small"
                      onClick={() =>
                        void (
                          online.failure === 'backend-unavailable'
                            ? musicStatus.reconnect()
                            : Promise.resolve()
                        ).then(() => search.onlinePreview.load(['track']))
                      }
                    >
                      {t('album.retry')}
                    </Button>
                  </>
                ))}
              {online.status === 'ready' &&
                online.items.length === 0 &&
                t('online.noResults', { text: draft, platform: onlinePlatform })}
            </div>
          )}
          {recent.failed && !session.draft && (
            <div role="status" className={styles.notice}>
              {t('search.historyFailed')}{' '}
              <Button size="small" onClick={() => void search.recent.retry()}>
                {t('album.retry')}
              </Button>
            </div>
          )}
          {(notice || playNotice || queueNotice) && (
            <div role="status" className={styles.notice}>
              {t(notice ?? playNotice ?? queueNotice ?? 'album.playFailed')}
            </div>
          )}
          {menuFailed && (
            <div role="status" className={styles.notice}>
              {t('album.commandFailed')}
            </div>
          )}
        </div>
        <SearchResultMenu
          menu={search.previewMenu}
          at={menuAt}
          text={draft}
          onClose={() => setMenuAt(null)}
        />
        <OnlineTrackMenu
          menu={onlineMenu}
          onClose={() => setOnlineMenu(null)}
          onPlay={(picked) => {
            if (picked[0]) session.playOnline(picked[0]);
          }}
          onQueued={(ok) => setQueueNotice(ok ? null : 'online.queueFailed')}
        />
        {!!session.draft.trim() && (
          <div className={styles.footer}>
            <Button
              appearance="subtle"
              icon={<ArrowRight16Regular />}
              onClick={() =>
                session.submit(
                  undefined,
                  onlineScope ? { scope: 'online', category: 'all' } : undefined,
                )
              }
            >
              {t('search.viewAll')}
            </Button>
          </div>
        )}
      </div>
    </Portal>
  );
}
