import { Button, SearchBox, Title2, Tooltip, mergeClasses } from '@fluentui/react-components';
import {
  ArrowShuffle20Regular,
  Dismiss20Regular,
  HeartBroken20Regular,
  Next20Regular,
  Play20Regular,
  Search16Regular,
  TextBulletListAdd20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { CommandBar, type CommandBarTier } from '../../kit/CommandBar.tsx';
import { SortMenu, type SortOption } from '../../kit/SortMenu.tsx';
import type { FavoriteKind } from '../../server/musicFavorites.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { CategoryTabs } from '../search/SearchCategoryTabs.tsx';
import styles from './FavoritesHeader.module.css';

export type FavoriteTab = 'tracks' | 'albums' | 'artists' | 'playlists';

/** 页签对应哪一类收藏 */
export const TAB_KINDS = {
  tracks: 'track',
  albums: 'album',
  artists: 'artist',
  playlists: 'playlist',
} as const satisfies Record<FavoriteTab, FavoriteKind>;

const TAB_LABELS = {
  tracks: 'favorites.tab.tracks',
  albums: 'favorites.tab.albums',
  artists: 'favorites.tab.artists',
  playlists: 'favorites.tab.playlists',
} as const satisfies Record<FavoriteTab, MessageKey>;

const TABS: readonly FavoriteTab[] = ['tracks', 'albums', 'artists', 'playlists'];

/** 曲目表里选中两首以上时的选区操作 */
export interface FavoritesSelection {
  readonly count: number;
  onPlay(): void;
  onNext(): void;
  onEnqueue(): void;
  onUnfavorite(): void;
  onClear(): void;
}

export interface FavoritesHeaderProps {
  readonly tier: CommandBarTier;
  readonly tab: FavoriteTab;
  onTab(tab: FavoriteTab): void;
  readonly counts: Readonly<Record<FavoriteKind, number>>;
  /** 读到收藏之前页签上不写个数 */
  readonly ready: boolean;
  readonly query: string;
  onQuery(query: string): void;
  /** 排序：字段选项、当前字段与方向 */
  readonly sortOptions: readonly SortOption<string>[];
  readonly sortField: string;
  readonly descending: boolean;
  onSort(field: string): void;
  onDescending(descending: boolean): void;
  /** 播放全部、随机、加入队列作用于曲目页签里此刻显示的全部曲目；没有曲目时置灰 */
  readonly playable: boolean;
  onPlayAll(): void;
  onShuffle(): void;
  onQueueAll(): void;
  readonly selection: FavoritesSelection | null;
}

/**
 * 收藏页页头：标题行左边是标题，右边是播放全部、随机与加入队列；下面一行页签在左（页签名后写各类的个数）、
 * 命令栏占余宽，命令栏左边查找，右边排序。曲目表选中两首以上时，命令栏左半换成选区操作
 */
export function FavoritesHeader(props: FavoritesHeaderProps) {
  const { tier, tab, counts, selection } = props;
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const narrow = tier === 'narrow';
  const box = (
    <SearchBox
      className={mergeClasses(controls.field, styles.search)}
      appearance="filled-darker"
      contentBefore={<Search16Regular />}
      value={props.query}
      placeholder={t('favorites.find')}
      aria-label={t('favorites.find')}
      dismiss={{ 'aria-label': t('query.clear') }}
      onChange={(_, data) => props.onQuery(data.value)}
      data-favorites-find
    />
  );
  const selectionCommands = selection
    ? ([
        ['context.playSelected', <Play20Regular key="play" />, selection.onPlay],
        ['album.playNext', <Next20Regular key="next" />, selection.onNext],
        ['album.enqueue', <TextBulletListAdd20Regular key="queue" />, selection.onEnqueue],
        ['favorite.removeSelected', <HeartBroken20Regular key="remove" />, selection.onUnfavorite],
      ] as const)
    : [];
  const bar = selection ? (
    <div className={styles.selection} data-selection-bar>
      <Tooltip content={t('favorites.clearSelection')} relationship="label">
        <Button
          appearance="subtle"
          className={controls.icon}
          icon={<Dismiss20Regular />}
          aria-label={t('favorites.clearSelection')}
          onClick={selection.onClear}
        />
      </Tooltip>
      <span className={styles.selected}>{t('favorites.selected', { count: selection.count })}</span>
      {selectionCommands.map(([label, icon, run]) => (
        <Tooltip key={label} content={t(label)} relationship="label">
          <Button
            appearance="subtle"
            className={controls.icon}
            icon={icon}
            aria-label={t(label)}
            onClick={run}
          />
        </Tooltip>
      ))}
    </div>
  ) : undefined;
  return (
    <header className={styles.root} data-tier={tier}>
      <div className={styles.titleRow}>
        <div className={styles.titles}>
          <Title2 as="h1" className={styles.title}>
            {t('place.favorites')}
          </Title2>
        </div>
        <div className={styles.actions}>
          <Tooltip content={t('album.playAll')} relationship="label">
            <Button
              appearance="primary"
              icon={<Play20Regular />}
              disabled={!props.playable}
              onClick={props.onPlayAll}
              data-favorites-play-all
            >
              {narrow ? undefined : t('album.playAll')}
            </Button>
          </Tooltip>
          <Tooltip content={t('album.shuffleAll')} relationship="label">
            <Button
              appearance="subtle"
              className={controls.icon}
              icon={<ArrowShuffle20Regular />}
              aria-label={t('album.shuffleAll')}
              disabled={!props.playable}
              onClick={props.onShuffle}
            />
          </Tooltip>
          <Tooltip content={t('album.enqueue')} relationship="label">
            <Button
              appearance="subtle"
              className={controls.icon}
              icon={<TextBulletListAdd20Regular />}
              aria-label={t('album.enqueue')}
              disabled={!props.playable}
              onClick={props.onQueueAll}
            />
          </Tooltip>
        </div>
      </div>
      <div className={styles.toolRow}>
        <CategoryTabs
          category={tab}
          options={TABS.map((value) => ({
            value,
            label: t(TAB_LABELS[value]),
            // 读到收藏之前不写；写的是各类的总数，不随查找变
            ...(props.ready ? { count: counts[TAB_KINDS[value]] } : {}),
          }))}
          narrow={narrow}
          label={t('favorites.tabs')}
          onChoose={props.onTab}
        />
        <span className={styles.rule} aria-hidden />
        <div className={styles.bar}>
          <CommandBar
            tier={tier}
            label={t('favorites.tabs')}
            search={{ box, active: props.query !== '' }}
            view={
              <SortMenu
                groups={[{ options: props.sortOptions }]}
                field={props.sortField}
                descending={props.descending}
                onField={props.onSort}
                onDescending={props.onDescending}
                tool={{ labelled: tier === 'wide' }}
              />
            }
            selection={bar}
          />
        </div>
      </div>
    </header>
  );
}
