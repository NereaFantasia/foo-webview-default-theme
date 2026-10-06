import {
  Button,
  Input,
  Menu,
  MenuDivider,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Title2,
  Tooltip,
  makeStyles,
} from '@fluentui/react-components';
import {
  Dismiss16Regular,
  Filter16Regular,
  LockClosed16Regular,
  Options16Regular,
  Sparkle16Regular,
} from '@fluentui/react-icons';
import type { PlaylistInfo } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { useCommand } from '../nav/useCommand.ts';
import { MENU_SURFACE_MOTION } from '../motion/MenuMotion.tsx';
import { durationText } from '../table/cellText.ts';
import type { PlaylistFilterState } from './filter/playlistFilter.ts';
import { FILTER_SCOPES, type FilterScope } from './filter/playlistMatch.ts';
import styles from './PlaylistPageHeader.module.css';
import { useService } from '../kit/useService.ts';
import { playlistPageKey } from './playlistPageServices.ts';

const useStyles = makeStyles({
  title: {
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  filter: { width: '240px', minWidth: '160px', flexShrink: 1 },
});

const SCOPE_LABELS: Record<FilterScope, MessageKey> = {
  all: 'playlistPage.scopeAll',
  artist: 'playlistPage.scopeArtist',
  title: 'playlistPage.scopeTitle',
  album: 'playlistPage.scopeAlbum',
  genre: 'playlistPage.scopeGenre',
  date: 'playlistPage.scopeDate',
  albumArtist: 'playlistPage.scopeAlbumArtist',
  filename: 'playlistPage.scopeFilename',
  comment: 'playlistPage.scopeComment',
};

export interface PlaylistPageHeaderProps {
  readonly guid: string;
  readonly entry: PlaylistInfo | undefined;
  /** 列表的曲目数，按行服务取回的那个数。 */
  readonly total: number;
  readonly filter: PlaylistFilterState;
  /** 过滤框右边的键。 */
  readonly children?: ReactNode;
}

/**
 * 播放列表页的页头：左边列表名、锁定与智能列表的记号，副题「N 首 · 总时长」，过滤时再接「命中 M 首」；右边页内过滤框，
 * 框里有字时出清空键，框尾的键选按哪个字段找。清空键与 Esc 只清过滤词，条件留着；框是空的 Esc 就不认领。
 */
export function PlaylistPageHeader(props: PlaylistPageHeaderProps) {
  const { guid, entry, total, filter, children } = props;
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const playlistPage = useService(playlistPageKey);
  const scope = useAtomValueRawSync(playlistPage.filter.scopeAtom);
  useEffect(() => playlistPage.duration.acquire(guid), [playlistPage, guid]);
  const duration = useAtomValueRawSync(playlistPage.duration.stateOf(guid));
  const classes = useStyles();
  const input = useRef<HTMLInputElement>(null);

  useCommand({
    id: `playlistPage.filter.clear.${guid}`,
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () => filter.query !== '' && document.activeElement === input.current,
    run: () => playlistPage.filter.clearQuery(guid),
  });

  const parts = [t(plural(total, 'album.menuTracksOne', 'album.menuTracks'), { count: total })];
  const length = duration === null ? '' : durationText(duration);
  if (length) parts.push(length);
  if (filter.active) {
    const hits = filter.hits.length;
    parts.push(
      t(plural(hits, 'playlistPage.matchCountOne', 'playlistPage.matchCount'), { count: hits }),
    );
  }
  return (
    <header className={styles.root}>
      <div className={styles.titles}>
        <Title2 as="h1" className={classes.title} title={entry?.name}>
          {entry?.name ?? ''}
        </Title2>
        {entry?.isLocked && (
          <Tooltip content={t('playlist.locked')} relationship="label">
            <LockClosed16Regular className={styles.mark} data-playlist-mark="locked" />
          </Tooltip>
        )}
        {entry?.isAutoplaylist && (
          <Tooltip content={t('playlistPage.autoplaylist')} relationship="label">
            <Sparkle16Regular className={styles.mark} data-playlist-mark="auto" />
          </Tooltip>
        )}
        {entry && (
          <span className={styles.subtitle} data-playlist-subtitle>
            {parts.join(' · ')}
          </span>
        )}
      </div>
      <div className={styles.tools}>
        <Input
          ref={input}
          className={classes.filter}
          contentBefore={<Filter16Regular />}
          contentAfter={
            <>
              {filter.query !== '' && (
                <Tooltip content={t('playlistPage.clearFilter')} relationship="label">
                  <Button
                    appearance="transparent"
                    size="small"
                    icon={<Dismiss16Regular />}
                    onClick={() => {
                      playlistPage.filter.clearQuery(guid);
                      input.current?.focus();
                    }}
                    data-playlist-filter-clear
                  />
                </Tooltip>
              )}
              <Menu
                surfaceMotion={MENU_SURFACE_MOTION}
                checkedValues={{ scope: [scope] }}
                onCheckedValueChange={(_, data) => {
                  const next = FILTER_SCOPES.find((value) => data.checkedItems.includes(value));
                  if (next) playlistPage.filter.setScope(next);
                }}
              >
                <MenuTrigger disableButtonEnhancement>
                  <Tooltip content={t('playlistPage.scope')} relationship="label">
                    <Button
                      appearance="transparent"
                      size="small"
                      icon={<Options16Regular />}
                      data-playlist-scope
                    />
                  </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList aria-label={t('playlistPage.scope')}>
                    {FILTER_SCOPES.map((value) => (
                      <Fragment key={value}>
                        {/* 文件名与注释另成一节：它们不在「全部字段」里。 */}
                        {value === 'filename' && <MenuDivider />}
                        <MenuItemRadio name="scope" value={value}>
                          {t(SCOPE_LABELS[value])}
                        </MenuItemRadio>
                      </Fragment>
                    ))}
                  </MenuList>
                </MenuPopover>
              </Menu>
            </>
          }
          placeholder={t('playlistPage.filterPlaceholder')}
          aria-label={t('playlistPage.filter')}
          value={filter.query}
          onChange={(_, data) => playlistPage.filter.setQuery(guid, data.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') playlistPage.filter.flush(guid);
          }}
          data-playlist-filter
        />
        {children}
      </div>
    </header>
  );
}
