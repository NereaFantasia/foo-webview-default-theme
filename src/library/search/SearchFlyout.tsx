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
import { useLayoutEffect, useRef, useState } from 'react';
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
import {
  searchOptionId,
  type SearchSuggestion,
  type SuggestionGroup,
} from './searchSuggestions.ts';
import { useSearchFlyoutMotion } from './useSearchFlyoutMotion.ts';
import styles from './SearchFlyout.module.css';
import { useService } from '../../kit/useService.ts';
import { searchKey, type SearchTarget } from './searchServices.ts';
import { OnlineSuggestionRow } from './online/OnlineItems.tsx';
import { OnlineObjectMenu, objectTargetOf } from './online/OnlineObjectMenu.tsx';
import { OnlineTrackMenu } from './online/OnlineTrackMenu.tsx';
import type { OnlineTileMenu } from './online/useOnlineTileActions.ts';
import { SearchResultMenu } from './menus/SearchResultMenu.tsx';
import { platformName } from '../../playback/musicPlatforms.ts';
import type { MessageKey } from '../../i18n/en.ts';
import type { MusicAlbum, MusicArtist, MusicTrack } from '../../server/musicObjects.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import type { SearchHit } from './searchQuery.ts';

const MAX_WIDTH = 420;
// 节头是小号加粗的灰字，链接只取字号、不取字重
const useStyles = makeStyles({ more: { fontWeight: tokens.fontWeightRegular } });

const LIBRARY_GROUPS = ['recent', 'best', 'albums', 'tracks'] as const;
const ONLINE_GROUPS = ['onlineArtists', 'onlineAlbums', 'onlineTracks'] as const;
const GROUP_LABELS = {
  recent: 'search.recent',
  best: 'search.best',
  albums: 'search.albums',
  tracks: 'search.tracks',
  onlineArtists: 'search.artists',
  onlineAlbums: 'search.albums',
  onlineTracks: 'search.tracks',
} as const satisfies Record<SuggestionGroup, MessageKey>;

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
  const onlinePlatform = platformName(t, useAtomValueRawSync(search.onlinePreview.platform));
  const totals = {
    onlineArtists: useAtomValueRawSync(search.onlinePreview.kinds.artist).total,
    onlineAlbums: useAtomValueRawSync(search.onlinePreview.kinds.album).total,
    onlineTracks: useAtomValueRawSync(search.onlinePreview.kinds.track).total,
  };
  const menuFailed = useAtomValueRawSync(search.previewMenu.notice);
  // 媒体库行、在线曲目与在线艺人专辑的右键菜单各一份，同一时刻只开一个；菜单在浮层的组件树里，点它不算点在外面
  const [menuAt, setMenuAt] = useState<TablePoint | null>(null);
  const [onlineMenu, setOnlineMenu] = useState<{
    readonly at: TablePoint;
    readonly tracks: readonly MusicTrack[];
  } | null>(null);
  const [objectMenu, setObjectMenu] = useState<OnlineTileMenu | null>(null);
  const [queueNotice, setQueueNotice] = useState<MessageKey | null>(null);
  const closeMenus = () => {
    search.previewMenu.close();
    setMenuAt(null);
    setOnlineMenu(null);
    setObjectMenu(null);
  };
  const openMenu = (hit: SearchHit, at: TablePoint) => {
    closeMenus();
    void search.previewMenu.open(hit);
    setMenuAt(at);
  };
  const draft = session.draft.trim();
  const online = session.online;
  // 有搜索词且在线一区在时分两区，各带区标题；否则与只搜媒体库时一样
  const sections = !!draft && online.phase !== 'off';
  const { panel, present } = useSearchFlyoutMotion(session.open);
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ left: 8, top: 40, width: MAX_WIDTH, maxHeight: 500 });
  const markInside = useLightDismiss({
    id: 'search.dismiss',
    open: session.open,
    panel,
    // 搜索框整个（含图标、清除键）都不算在外面
    exempt: (target) =>
      !!target.closest('[data-search-input], [data-search-box], [data-search-trigger]'),
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
  // 列表能占的高度是最大高度减去输入框、节头与底栏这些不随条数变的部分，各组条数按它收
  useLayoutEffect(() => {
    const root = panel.current;
    const list = scroller.current;
    if (!session.open || !root || !list) return;
    const style = getComputedStyle(list);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    session.fit(Math.max(0, box.maxHeight - (root.offsetHeight - list.clientHeight) - padding));
  });
  useLayoutEffect(() => {
    if (session.active)
      document.getElementById(searchOptionId(session.active))?.scrollIntoView({ block: 'nearest' });
  }, [session.active]);
  if (!present) return null;

  const link = (group: SuggestionGroup): { text: string; target: SearchTarget } | null => {
    const view = (count: number | null, one: MessageKey, many: MessageKey) =>
      count === null ? '' : t(plural(count, one, many), { count });
    switch (group) {
      case 'albums':
        return {
          text: view(albums.length, 'search.viewAlbumsOne', 'search.viewAlbums'),
          target: { scope: 'library', category: 'albums' },
        };
      case 'tracks':
        return {
          text: view(preview.total, 'search.viewTracksOne', 'search.viewTracks'),
          target: { scope: 'library', category: 'tracks' },
        };
      case 'onlineArtists':
        return {
          text: view(totals[group], 'search.viewArtistsOne', 'search.viewArtists'),
          target: { scope: 'online', category: 'artists' },
        };
      case 'onlineAlbums':
        return {
          text: view(totals[group], 'search.viewAlbumsOne', 'search.viewAlbums'),
          target: { scope: 'online', category: 'albums' },
        };
      case 'onlineTracks':
        return {
          text: view(totals[group], 'search.viewTracksOne', 'search.viewTracks'),
          target: { scope: 'online', category: 'tracks' },
        };
      default:
        return null;
    }
  };
  const openObject = (key: string, item: MusicArtist | MusicAlbum) => ({
    onOpen: () => {
      session.select(key);
      session.openOnline(item);
    },
    onMenu: (at: TablePoint) => {
      session.select(key);
      closeMenus();
      setObjectMenu({ at, target: objectTargetOf(item) });
    },
  });
  const row = (item: SearchSuggestion) => {
    const id = searchOptionId(item.key);
    const selected = session.active === item.key;
    switch (item.group) {
      case 'recent':
        return (
          <div key={item.key} className={styles.history}>
            <div
              role="option"
              id={id}
              aria-selected={selected}
              className={styles.word}
              data-selected={selected || undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => session.accept(item)}
            >
              {item.text}
            </div>
            <Tooltip content={t('search.removeHistory', { text: item.text })} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={<Dismiss16Regular />}
                aria-label={t('search.removeHistory', { text: item.text })}
                onClick={() => {
                  search.recent.remove(item.text);
                  session.show('');
                }}
              />
            </Tooltip>
          </div>
        );
      case 'onlineTracks':
        return (
          <OnlineSuggestionRow
            key={item.key}
            item={item.track}
            id={id}
            selected={selected}
            onOpen={() => {
              session.select(item.key);
              session.submit(session.draft, {
                scope: 'online',
                category: 'tracks',
                focus: item.track.ref.id,
              });
            }}
            onMenu={(at) => {
              session.select(item.key);
              closeMenus();
              setOnlineMenu({ at, tracks: [item.track] });
            }}
          />
        );
      case 'onlineArtists':
      case 'onlineAlbums': {
        const target = item.group === 'onlineArtists' ? item.artist : item.album;
        return (
          <OnlineSuggestionRow
            key={item.key}
            item={target}
            id={id}
            selected={selected}
            {...openObject(item.key, target)}
          />
        );
      }
      default:
        return (
          <SearchResultRow
            key={item.key}
            hit={item.hit}
            id={id}
            option
            selected={selected}
            onOpen={() => {
              session.select(item.key);
              session.activate(item.hit, session.draft);
            }}
            onMenu={(hit, at) => {
              session.select(item.key);
              openMenu(hit, at);
            }}
          />
        );
    }
  };
  const group = (name: SuggestionGroup, section: MessageKey) => {
    const rows = session.suggestions.filter((item) => item.group === name);
    if (!rows.length) return null;
    const label = t(GROUP_LABELS[name]);
    const more = link(name);
    return (
      <div key={name} role="group" aria-label={sections ? `${t(section)} ${label}` : label}>
        {name !== 'recent' && (
          <div className={styles.heading}>
            {label}
            {more?.text && (
              <Link
                className={classes.more}
                onClick={() => session.submit(session.draft, more.target)}
              >
                {more.text}
              </Link>
            )}
          </div>
        )}
        {rows.map(row)}
      </div>
    );
  };
  const onlineEmpty =
    online.phase === 'ready' &&
    online.artists.length + online.albums.length + online.tracks.length === 0;
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
        {!draft && (
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
        <div ref={scroller} className={styles.scroller}>
          <div
            id="global-search-suggestions"
            role="listbox"
            aria-label={t('search.suggestions')}
            aria-busy={preview.status === 'loading' || online.phase === 'waiting'}
          >
            {/* 区标题只是给眼睛看的分隔，读屏从各组的名字里听到所属的区 */}
            {sections && (
              <div className={styles.section} aria-hidden>
                {t('online.scopeLibrary')}
              </div>
            )}
            {LIBRARY_GROUPS.map((name) => group(name, 'online.scopeLibrary'))}
            {sections && (
              <>
                <div role="presentation">
                  <SearchFeedback results={search.preview} />
                </div>
                <div className={styles.section} data-second aria-hidden>
                  {t('online.scopeOnline')}
                </div>
                {ONLINE_GROUPS.map((name) => group(name, 'online.scopeOnline'))}
                {online.phase === 'waiting' && (
                  <div className={styles.notice} role="status">
                    <Spinner size="tiny" label={t('album.loading')} />
                  </div>
                )}
                {online.phase === 'failed' && (
                  <div className={styles.notice} role="status">
                    {t(
                      online.failure === 'backend-unavailable'
                        ? 'online.unavailableTitle'
                        : 'online.searchFailed',
                      { platform: onlinePlatform },
                    )}{' '}
                    <Button size="small" onClick={session.retryOnline}>
                      {t('album.retry')}
                    </Button>
                  </div>
                )}
                {onlineEmpty && (
                  <div className={styles.notice} role="status">
                    {t('online.noResults', { text: draft, platform: onlinePlatform })}
                  </div>
                )}
              </>
            )}
          </div>
          {!sections && <SearchFeedback results={search.preview} />}
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
        <OnlineObjectMenu
          menu={objectMenu}
          onClose={() => setObjectMenu(null)}
          onFailed={setQueueNotice}
        />
        {!!draft && (
          <div className={styles.footer}>
            <Button
              appearance="subtle"
              icon={<ArrowRight16Regular />}
              onClick={() => session.submit()}
            >
              {t('search.viewAll')}
            </Button>
          </div>
        )}
      </div>
    </Portal>
  );
}
