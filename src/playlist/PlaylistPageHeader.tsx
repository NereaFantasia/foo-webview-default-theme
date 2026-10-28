import {
  Button,
  Input,
  Title2,
  Tooltip,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';
import {
  Dismiss16Regular,
  Filter16Regular,
  LockClosed16Regular,
  Play20Regular,
  Search16Regular,
  Sparkle16Regular,
  Clock16Regular,
  TextNumberListLtr16Regular,
} from '@fluentui/react-icons';
import type { PlaylistInfo } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { useCommand } from '../nav/useCommand.ts';
import { durationText } from '../table/cellText.ts';
import type { PlaylistFilterState } from './filter/playlistFilter.ts';
import { QueryScopeMenu } from '../track/QueryScopeMenu.tsx';
import styles from './PlaylistPageHeader.module.css';
import { COMMAND_BAR_TIERS, CommandBar, type CommandBarTier } from '../kit/CommandBar.tsx';
import { useWidthTier } from '../kit/useWidthTier.ts';
import { useService } from '../kit/useService.ts';
import { playlistPageKey } from './playlistPageServices.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { Metadata, MetadataItem } from '../kit/Metadata.tsx';

const useStyles = makeStyles({
  title: {
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  filter: { width: '100%', minWidth: 0 },
  clear: { flexShrink: 0 },
});

export interface PlaylistPageHeaderProps {
  readonly guid: string;
  readonly entry: PlaylistInfo | undefined;
  /** 列表的曲目数，按行服务取回的那个数 */
  readonly total: number;
  readonly filter: PlaylistFilterState;
  /** 从眼前第一行起播；还没有可播的行时为 null */
  readonly play: (() => void) | null;
  /** 命令栏右端的视图键；宽档带字 */
  readonly view: (labelled: boolean) => ReactNode;
  /** 选中两首以上时的选区操作，代替命令栏左半的过滤框；没有选区时返回 false */
  readonly selection: (labelled: boolean) => ReactNode;
  /** 播放键右边的 ⋯ */
  readonly children?: ReactNode;
}

/**
 * 播放列表页的页头。标题行左边是列表名、锁定与自动播放列表的记号，副题写首数、总时长与过滤命中数；右边是播放与 ⋯
 * 命令栏左边是页内过滤框，框尾写着按哪个字段找；右边是视图。播放列表的条件从行菜单添加，不出筛选键
 * 清空键与 Esc 只清过滤词，条件留着；框是空的 Esc 就不认领
 */
export function PlaylistPageHeader(props: PlaylistPageHeaderProps) {
  const { guid, entry, total, filter, play, view, selection, children } = props;
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const playlistPage = useService(playlistPageKey);
  const scope = useAtomValueRawSync(playlistPage.filter.scopeAtom);
  useEffect(() => playlistPage.duration.acquire(guid), [playlistPage, guid]);
  const duration = useAtomValueRawSync(playlistPage.duration.stateOf(guid));
  const classes = useStyles();
  const controls = useViewControlStyles();
  const input = useRef<HTMLInputElement>(null);
  const [measure, tier] = useWidthTier<CommandBarTier, HTMLElement>(COMMAND_BAR_TIERS);

  useCommand({
    id: `playlistPage.filter.clear.${guid}`,
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () => filter.query !== '' && document.activeElement === input.current,
    run: () => playlistPage.filter.clearQuery(guid),
  });

  const length = duration === null ? '' : durationText(duration);
  const hits = filter.hits.length;
  const box = (
    <Input
      ref={input}
      className={mergeClasses(classes.filter, controls.field)}
      role="searchbox"
      contentBefore={<Search16Regular />}
      contentAfter={
        <>
          {filter.query !== '' && (
            <Tooltip content={t('playlistPage.clearFilter')} relationship="label">
              <Button
                className={mergeClasses(classes.clear, controls.icon)}
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
          <QueryScopeMenu scope={scope} onScope={playlistPage.filter.setScope} />
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
  );
  return (
    <header ref={measure} className={styles.root} data-tier={tier}>
      <div className={styles.titleRow}>
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
            <Metadata className={styles.subtitle} data-playlist-subtitle>
              <MetadataItem icon={<TextNumberListLtr16Regular />}>
                {t(plural(total, 'album.menuTracksOne', 'album.menuTracks'), { count: total })}
              </MetadataItem>
              {length && (
                <MetadataItem icon={<Clock16Regular />} label={t('table.duration')}>
                  {length}
                </MetadataItem>
              )}
              {filter.active && (
                <MetadataItem icon={<Filter16Regular />}>
                  {t(plural(hits, 'playlistPage.matchCountOne', 'playlistPage.matchCount'), {
                    count: hits,
                  })}
                </MetadataItem>
              )}
            </Metadata>
          )}
        </div>
        <div className={styles.actions}>
          <Tooltip content={t('playlistPage.play')} relationship="label">
            <Button
              appearance="primary"
              icon={<Play20Regular />}
              disabled={play === null}
              onClick={() => play?.()}
              data-playlist-play
            >
              {tier === 'narrow' ? undefined : t('playlistPage.play')}
            </Button>
          </Tooltip>
          {children}
        </div>
      </div>
      <CommandBar
        tier={tier}
        label={t('query.toolbar')}
        search={{ box, active: filter.query !== '' }}
        selection={selection(tier === 'wide') || undefined}
        view={view(tier === 'wide')}
      />
    </header>
  );
}
