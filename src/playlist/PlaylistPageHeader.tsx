import { Button, Title2, Tooltip, makeStyles } from '@fluentui/react-components';
import {
  Filter16Regular,
  LockClosed16Regular,
  Play20Regular,
  Sparkle16Regular,
  Clock16Regular,
  TextNumberListLtr16Regular,
} from '@fluentui/react-icons';
import type { PlaylistInfo } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { durationText } from '../table/cellText.ts';
import type { PlaylistFilterState } from './filter/playlistFilter.ts';
import { QueryBox, type QueryBoxHandle } from '../track/QueryBox.tsx';
import { QueryInvalidNotice } from '../track/QueryInvalidNotice.tsx';
import { queryInputText, type QueryInput } from '../track/queryInput.ts';
import styles from './PlaylistPageHeader.module.css';
import { CommandBar, type CommandBarTier } from '../kit/CommandBar.tsx';
import { FilterButton, type FilterSurfaceState } from '../track/FilterSurface.tsx';
import { useService } from '../kit/useService.ts';
import { playlistPageKey } from './playlistPageServices.ts';
import { Metadata, MetadataItem } from '../kit/Metadata.tsx';

const useStyles = makeStyles({
  title: {
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
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
  /** 页面量出来的命令栏宽度档，筛选浮层与页头共用这一档 */
  readonly tier: CommandBarTier;
  readonly surface: FilterSurfaceState;
  /** 生效的预设与条件个数，写在筛选键的角标上 */
  readonly conditions: number;
  /** 装没装 foo_playcount；null 是还没探出来 */
  readonly playcount: boolean | null;
  /** 播放键右边的 ⋯ */
  readonly children?: ReactNode;
}

/**
 * 播放列表页的页头。标题行左边是列表名、锁定与自动播放列表的记号，副题写首数、总时长与过滤命中数；右边是播放与 ⋯
 * 命令栏左边是页内过滤框与筛选键：框尾写着按哪个字段找，也能切到高级查询（fb2k 查询交宿主求值），筛选键打开
 * 常用预设与条件的浮层；右边是视图。清空键与 Esc 只清当前模式的文字，预设与条件留着；框是空的 Esc 就不认领
 * 高级查询被宿主认不出时命令栏下面给一条提示，命中仍是上一次的
 */
export function PlaylistPageHeader(props: PlaylistPageHeaderProps) {
  const {
    guid,
    entry,
    total,
    filter,
    play,
    view,
    selection,
    tier,
    surface,
    conditions,
    playcount,
    children,
  } = props;
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const playlistPage = useService(playlistPageKey);
  const scope = useAtomValueRawSync(playlistPage.filter.scopeAtom);
  useEffect(() => playlistPage.duration.acquire(guid), [playlistPage, guid]);
  const duration = useAtomValueRawSync(playlistPage.duration.stateOf(guid));
  const classes = useStyles();
  const queryBox = useRef<QueryBoxHandle>(null);
  const [queryOpen, setQueryOpen] = useState(false);

  const length = duration === null ? '' : durationText(duration);
  const hits = filter.hits.length;
  const queryInput: QueryInput = {
    mode: filter.mode,
    text: filter.query,
    advancedText: filter.advancedText,
  };
  const box = (
    <QueryBox
      handle={queryBox}
      input={queryInput}
      scope={scope}
      invalid={filter.invalid}
      playcountMissing={playcount === false}
      menuOpen={queryOpen}
      placeholder={t('playlistPage.filterPlaceholder')}
      label={t('playlistPage.filter')}
      onChange={(next) => playlistPage.filter.setInput(guid, next)}
      onEnter={() => playlistPage.filter.flush(guid)}
      onScope={playlistPage.filter.setScope}
      onMenuOpenChange={setQueryOpen}
    />
  );
  return (
    <header className={styles.root} data-tier={tier}>
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
        search={{ box, active: queryInputText(queryInput) !== '' }}
        find={<FilterButton state={surface} count={conditions} labelled={tier === 'wide'} />}
        selection={selection(tier === 'wide') || undefined}
        view={view(tier === 'wide')}
      />
      {filter.invalid && (
        <QueryInvalidNotice
          detail={t('playlistPage.queryInvalidDetail')}
          onHelp={() => queryBox.current?.openReference()}
        />
      )}
    </header>
  );
}
