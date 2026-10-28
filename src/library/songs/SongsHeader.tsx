import { Button, Link, Title2, Tooltip, makeStyles } from '@fluentui/react-components';
import {
  ArrowShuffle20Regular,
  Play20Regular,
  Clock16Regular,
  Library16Regular,
  TextNumberListLtr16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef, type ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { CommandBar, type CommandBarTier } from '../../kit/CommandBar.tsx';
import { FilterButton, type FilterSurfaceState } from '../../track/FilterSurface.tsx';
import { QueryBox } from '../../track/QueryBox.tsx';
import { queryInputText } from '../../track/queryInput.ts';
import { TrackSortMenu } from '../../track/TrackSortMenu.tsx';
import { spanText } from '../../track/trackSpan.ts';
import { playStatsAtom } from '../playStats.ts';
import styles from './SongsHeader.module.css';
import { SongsMoreMenu } from './SongsMoreMenu.tsx';
import { SongsViewPanel } from './SongsViewPanel.tsx';
import { songsPrefsAtom } from './songsPrefs.ts';
import type { SongsPageModel } from './useSongsPage.ts';
import { useService } from '../../kit/useService.ts';
import { songsKey } from './songsServices.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { Metadata, MetadataItem } from '../../kit/Metadata.tsx';

const useStyles = makeStyles({
  title: { margin: 0, whiteSpace: 'nowrap' },
});

export interface SongsHeaderProps {
  readonly model: SongsPageModel;
  /** 选中两首以上时的选区操作，代替命令栏左半的搜索与筛选 */
  readonly selection?: ReactNode;
  readonly queryOpen: boolean;
  readonly onQueryOpenChange: (open: boolean) => void;
  readonly tier: CommandBarTier;
  readonly surface: FilterSurfaceState;
  /** 生效的条件个数，写在筛选键的角标上 */
  readonly conditions: number;
}

/**
 * 歌曲页的页头。标题行左边是标题与曲目统计，右边是播放、随机与 ⋯；命令栏左边是搜索框与筛选，右边是排序与视图
 * 查询有误时保留上次结果并暂停起播，错误说明提供打开查询菜单的入口
 */
export function SongsHeader({
  model,
  selection,
  queryOpen,
  onQueryOpenChange,
  tier,
  surface,
  conditions,
}: SongsHeaderProps) {
  const controls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const prefs = useAtomValueRawSync(songsPrefsAtom);
  const { available } = useAtomValueRawSync(playStatsAtom);
  const songs = useService(songsKey);
  const classes = useStyles();
  const input = useRef<HTMLInputElement>(null);
  const { rows, library, filter, query, view, run } = model;
  const numbers = new Intl.NumberFormat();
  const count = (n: number) =>
    t(plural(n, 'songs.countOne', 'songs.count'), { count: numbers.format(n) });
  const total = rows.handles.length;
  const libraryTotal = library.byHandle.size;

  const parts: SubtitlePart[] = [];
  if (rows.status === 'failed' || library.status === 'failed')
    parts.push({ text: t('songs.readFailed') });
  else if (rows.invalid && !model.settled)
    parts.push({ text: count(0), icon: <TextNumberListLtr16Regular /> });
  else if (!model.settled) parts.push({ text: t('songs.loading') });
  else {
    parts.push({ text: count(total), icon: <TextNumberListLtr16Regular /> });
    const span = spanText(view.duration, t, plural);
    if (span) parts.push({ text: span, icon: <Clock16Regular />, label: t('table.duration') });
    if (query.filtered) {
      const all = numbers.format(libraryTotal);
      parts.push({
        text: t(plural(libraryTotal, 'songs.ofLibraryOne', 'songs.ofLibrary'), { count: all }),
        icon: <Library16Regular />,
      });
    }
  }
  const playable = model.resultsCurrent && total > 0;
  const first = rows.handles[0];
  const narrow = tier === 'narrow';
  const actionLabels = !narrow;
  const toolLabels = tier === 'wide';

  return (
    <header className={styles.root} data-tier={tier} data-songs-header>
      <div className={styles.titleRow}>
        <div className={styles.titles}>
          <Title2 as="h1" className={classes.title}>
            {t('songs.title')}
          </Title2>
          <Metadata
            className={styles.subtitle}
            title={parts.map((part) => part.text).join(' · ')}
            data-songs-subtitle
          >
            {(narrow ? parts.slice(0, 1) : parts).map((part) =>
              part.icon ? (
                <MetadataItem key={part.text} icon={part.icon} label={part.label}>
                  {part.text}
                </MetadataItem>
              ) : (
                <span key={part.text}>{part.text}</span>
              ),
            )}
          </Metadata>
        </div>
        <div className={styles.actions}>
          <Tooltip content={t('songs.play')} relationship="label">
            <Button
              appearance="primary"
              icon={<Play20Regular />}
              disabled={!playable || first === undefined}
              onClick={() => first && void songs.actions.play(run, { row: 0, handle: first })}
              data-songs-play
            >
              {actionLabels ? t('songs.play') : undefined}
            </Button>
          </Tooltip>
          <Tooltip content={t('songs.shuffle')} relationship="label">
            <Button
              appearance="subtle"
              className={controls.icon}
              icon={<ArrowShuffle20Regular />}
              disabled={!playable}
              onClick={() => void songs.actions.play(run, 'shuffle')}
              data-songs-shuffle
            >
              {actionLabels ? t('songs.shuffle') : undefined}
            </Button>
          </Tooltip>
          <SongsMoreMenu model={model} />
        </div>
      </div>
      <CommandBar
        tier={tier}
        label={t('query.toolbar')}
        selection={selection}
        search={{
          active: queryInputText(filter) !== '',
          box: (
            <QueryBox
              inputRef={input}
              input={filter}
              scope={prefs.scope}
              invalid={rows.invalid && query.raw}
              menuOpen={queryOpen}
              placeholder={t('songs.filterShort')}
              label={t('songs.filter')}
              onChange={songs.filter.setQuery}
              onEnter={() => songs.rows.flush()}
              onScope={(scope) => songs.prefs.setScope(scope)}
              onMenuOpenChange={onQueryOpenChange}
            />
          ),
        }}
        find={<FilterButton state={surface} count={conditions} labelled={toolLabels} />}
        view={
          <>
            <TrackSortMenu
              sort={prefs.sort}
              playcount={available}
              labelled={toolLabels}
              onSort={(next) => {
                if (next) songs.prefs.setSort(next);
              }}
            />
            <SongsViewPanel model={model} labelled={toolLabels} />
          </>
        }
      />
      {rows.invalid && query.raw && (
        <div className={styles.invalid} role="status" data-songs-invalid>
          <span>{t('songs.queryInvalidDetail', { count: numbers.format(total) })}</span>
          <Link
            as="button"
            onClick={() => {
              input.current?.focus();
              onQueryOpenChange(true);
            }}
          >
            {t('songs.queryHelp')}
          </Link>
        </div>
      )}
    </header>
  );
}

interface SubtitlePart {
  readonly text: string;
  readonly icon?: ReactNode;
  readonly label?: string;
}
