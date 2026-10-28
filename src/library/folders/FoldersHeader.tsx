import {
  Button,
  Link,
  Title2,
  Tooltip,
  makeStyles,
  useRestoreFocusTarget,
} from '@fluentui/react-components';
import {
  ArrowShuffle20Regular,
  ChevronRight12Regular,
  Folder16Regular,
  Filter16Regular,
  MoreHorizontal20Regular,
  PanelLeft20Regular,
  Play20Regular,
  TextNumberListLtr16Regular,
  Video16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { CommandBar, type CommandBarTier } from '../../kit/CommandBar.tsx';
import { Metadata, MetadataItem } from '../../kit/Metadata.tsx';
import type { TablePoint } from '../../table/tableItems.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import { FilterButton, type FilterSurfaceState } from '../../track/FilterSurface.tsx';
import { QueryBox } from '../../track/QueryBox.tsx';
import { queryInputText } from '../../track/queryInput.ts';
import { SelectionBar } from '../../track/SelectionBar.tsx';
import { TrackSortMenu } from '../../track/TrackSortMenu.tsx';
import { countRows, rowsOf } from '../../table/rangeSelection.ts';
import { playStatsAtom } from '../playStats.ts';
import type { FoldersTarget } from './actions/foldersActions.ts';
import type { FoldersView } from './detail/useFoldersView.ts';
import { FoldersViewPanel } from './FoldersViewPanel.tsx';
import styles from './FoldersHeader.module.css';
import { useService } from '../../kit/useService.ts';
import { foldersKey } from './foldersServices.ts';
import { foldersTreeAtom } from './tree/foldersTree.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

const useStyles = makeStyles({
  title: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

export interface FoldersHeaderProps {
  readonly model: FoldersView;
  readonly tier: CommandBarTier;
  /** 目录树收进抽屉：标题前出「目录」键 */
  readonly compact: boolean;
  readonly surface: FilterSurfaceState;
  readonly conditions: number;
  readonly sort: TableSort | null;
  onSort(sort: TableSort | null): void;
  onDirectory(): void;
  onMenu(target: FoldersTarget, point: TablePoint): void;
}

/**
 * 文件夹页的页头。标题行左边是上级路径与目录名（点哪一级去哪一级）和统计，右边是播放、随机与 ⋯，固定与重新读取
 * 目录在 ⋯ 里；命令栏左边是搜索框与筛选（目录范围在筛选里），右边是排序与视图
 */
export function FoldersHeader(props: FoldersHeaderProps) {
  const { model, tier, compact, surface, conditions, sort, onSort, onDirectory, onMenu } = props;
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const folders = useService(foldersKey);
  const catalog = useAtomValueRawSync(foldersTreeAtom);
  const { available } = useAtomValueRawSync(playStatsAtom);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const drawerTrigger = useRestoreFocusTarget();
  const input = useRef<HTMLInputElement>(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const { preview, results, prefs, conditions: filter, structure, playable } = model;
  const { ranges } = useAtomValueRawSync(model.selection.state);
  const node = preview.node;
  const path = [];
  let entry = node;
  while (entry) {
    path.unshift(entry);
    entry = entry.parent ? (catalog.nodes.get(entry.parent) ?? null) : null;
  }
  const ancestors = path.slice(0, -1);
  const title =
    preview.nodes.length > 1
      ? t('folders.selected', { count: preview.nodes.length })
      : (node?.name ?? t('folders.title'));
  const directoryCount =
    model.full.groups.length === 1
      ? (model.full.groups[0]?.children.length ?? 0)
      : model.full.groups.length;
  const loading = preview.status === 'loading' || results.status === 'loading';
  const count = loading
    ? t('folders.loading')
    : results.filtered
      ? t('folders.matches', { count: results.tracks.length, total: results.total })
      : t('folders.summary', {
          directories: directoryCount,
          count: preview.status === 'ready' ? results.total : (node?.count ?? 0),
        });
  const total = preview.status === 'ready' ? results.total : (node?.count ?? 0);
  const target: FoldersTarget = { nodes: preview.nodes, tracks: structure.tracks };
  function play(shuffle: boolean) {
    const tracks = [...structure.tracks];
    if (shuffle)
      for (let i = tracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const first = tracks[i],
          second = tracks[j];
        if (first && second) {
          tracks[i] = second;
          tracks[j] = first;
        }
      }
    void folders.actions.run({ ...target, tracks }, 'play');
  }
  // 表格里选中两首以上时，命令栏左半换成作用于这批曲目的选区操作；行序号就是曲目在本目录结构里的序号
  const selected = prefs.view === 'list' ? countRows(ranges) : 0;
  const picked = (): FoldersTarget => ({
    nodes: preview.nodes,
    tracks: rowsOf(ranges).flatMap((index) => structure.tracks[index] ?? []),
    trackMenu: true,
    ratingStamp: preview.stamp,
  });
  const selection = selected > 1 && (
    <SelectionBar
      count={selected}
      labelled={tier === 'wide'}
      queueLimited={selected > 256}
      handlers={{
        play: () => void folders.actions.run(picked(), 'play'),
        next: () => void folders.actions.run(picked(), 'next'),
        enqueue: () => void folders.actions.run(picked(), 'queue'),
        sendToNew: () => void folders.actions.run(picked(), 'new'),
        sendTo: ({ guid }) => void folders.actions.run(picked(), { guid }),
      }}
      onClear={() => model.selection.clear()}
      onMore={(point) => onMenu(picked(), point)}
    />
  );
  const playLabel = t(results.filtered ? 'folders.playResults' : 'folders.play');
  const actionLabels = tier !== 'narrow';
  const toolLabels = tier === 'wide';
  return (
    <header className={styles.root} data-tier={tier}>
      <div className={styles.titleRow}>
        {compact && (
          <Tooltip content={t('folders.directory')} relationship="label">
            <Button
              {...drawerTrigger}
              appearance="subtle"
              className={controls.icon}
              icon={<PanelLeft20Regular />}
              onClick={onDirectory}
            />
          </Tooltip>
        )}
        <div className={styles.identity}>
          <nav
            className={styles.crumbs}
            aria-label={t('folders.path')}
            aria-hidden={ancestors.length === 0}
          >
            {ancestors.map((part) => (
              <span key={part.key} className={styles.crumb}>
                <button
                  type="button"
                  title={part.absolutePath}
                  onClick={() => void folders.visit(part.key)}
                >
                  {part.name}
                </button>
                <ChevronRight12Regular />
              </span>
            ))}
          </nav>
          <div className={styles.titles}>
            <Title2 as="h1" className={classes.title} title={title}>
              {title}
            </Title2>
            <Metadata className={styles.count} title={count}>
              {loading ? (
                count
              ) : results.filtered ? (
                <MetadataItem icon={<Filter16Regular />}>{count}</MetadataItem>
              ) : (
                <>
                  <MetadataItem icon={<Folder16Regular />}>
                    {t(
                      plural(directoryCount, 'folders.directoryCountOne', 'folders.directoryCount'),
                      { count: directoryCount },
                    )}
                  </MetadataItem>
                  {model.media === 'video' ? (
                    <MetadataItem icon={<Video16Regular />}>
                      {t(plural(total, 'folders.videoCountOne', 'folders.videoCount'), {
                        count: total,
                      })}
                    </MetadataItem>
                  ) : (
                    <MetadataItem icon={<TextNumberListLtr16Regular />}>
                      {t(plural(total, 'album.menuTracksOne', 'album.menuTracks'), {
                        count: total,
                      })}
                    </MetadataItem>
                  )}
                </>
              )}
            </Metadata>
          </div>
        </div>
        <div className={styles.actions}>
          <Tooltip content={playLabel} relationship="label">
            <Button
              appearance="primary"
              icon={<Play20Regular />}
              disabled={!playable}
              onClick={() => play(false)}
            >
              {actionLabels ? playLabel : undefined}
            </Button>
          </Tooltip>
          <Tooltip content={t('folders.shuffle')} relationship="label">
            <Button
              appearance="subtle"
              className={controls.icon}
              icon={<ArrowShuffle20Regular />}
              disabled={!playable}
              onClick={() => play(true)}
            >
              {actionLabels ? t('folders.shuffle') : undefined}
            </Button>
          </Tooltip>
          <Tooltip content={t('folders.more')} relationship="label">
            <Button
              className={controls.icon}
              appearance="subtle"
              icon={<MoreHorizontal20Regular />}
              disabled={preview.nodes.length === 0}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onMenu({ ...target, header: true }, { x: rect.x, y: rect.bottom });
              }}
              data-folders-more
            />
          </Tooltip>
        </div>
      </div>
      <CommandBar
        tier={tier}
        label={t('query.toolbar')}
        selection={selection || undefined}
        search={{
          active: queryInputText(filter) !== '',
          box: (
            <QueryBox
              inputRef={input}
              input={filter}
              scope={prefs.scope}
              invalid={results.invalid}
              menuOpen={queryOpen}
              onMenuOpenChange={setQueryOpen}
              label={t('folders.resultFilter')}
              placeholder={t('folders.resultFilterShort')}
              onChange={folders.results.setQuery}
              onEnter={folders.results.flush}
              onScope={(scope) => folders.prefs.change({ scope })}
            />
          ),
        }}
        find={<FilterButton state={surface} count={conditions} labelled={toolLabels} />}
        view={
          <>
            <TrackSortMenu
              sort={sort}
              playcount={available}
              onSort={onSort}
              labelled={toolLabels}
              defaultLabel={t('folders.directoryOrder')}
            />
            <FoldersViewPanel model={model} labelled={toolLabels} />
          </>
        }
      />
      {results.status === 'failed' && (
        <div className={styles.error} role="alert">
          <span>{t(results.invalid ? 'folders.invalidQuery' : 'folders.resultFailed')}</span>
          <Link
            as="button"
            onClick={() => {
              input.current?.focus();
              setQueryOpen(true);
            }}
          >
            {t('songs.queryHelp')}
          </Link>
          <Button className={controls.field} size="small" onClick={folders.results.flush}>
            {t('folders.retry')}
          </Button>
        </div>
      )}
    </header>
  );
}
