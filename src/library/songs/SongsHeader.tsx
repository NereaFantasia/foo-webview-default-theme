import {
  mergeClasses,
  Button,
  Link,
  Title2,
  ToggleButton,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { ArrowShuffle20Regular, Options20Regular, Play20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { useElementWidth } from '../../kit/useElementWidth.ts';
import { QueryBox } from '../../track/QueryBox.tsx';
import { spanText } from '../../track/trackSpan.ts';
import { playStatsAtom } from '../playStats.ts';
import { songFacetCount } from './songsFacets.ts';
import styles from './SongsHeader.module.css';
import { SongsMoreMenu } from './SongsMoreMenu.tsx';
import { songsPrefsAtom } from './songsPrefs.ts';
import type { SongsPageModel } from './useSongsPage.ts';
import { useService } from '../../kit/useService.ts';
import { songsKey } from './songsServices.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

const useStyles = makeStyles({
  title: { margin: 0, whiteSpace: 'nowrap' },
  query: { width: '320px', minWidth: '160px', flexShrink: 1 },
  wideQuery: { width: 'auto', minWidth: 0, flex: 1 },
  facetsActive: {
    '@media (forced-colors: none)': {
      color: tokens.colorBrandForeground1,
      backgroundImage: 'linear-gradient(var(--bg-selected), var(--bg-selected))',
      ':hover': {
        color: tokens.colorBrandForegroundLinkHover,
      },
    },
    '@media (forced-colors: active)': {
      borderBottomColor: 'Highlight',
      borderBottomWidth: tokens.strokeWidthThick,
      borderBottomStyle: 'solid',
    },
  },
});

/** 页头宽度的三档：够宽时按钮带字；窄一些只留图标；再窄过滤框单独一行。 */
type HeaderTier = 'wide' | 'medium' | 'narrow';
const tierOf = (width: number): HeaderTier =>
  width >= 880 ? 'wide' : width >= 560 ? 'medium' : 'narrow';

export interface SongsHeaderProps {
  readonly model: SongsPageModel;
  /** 选中了几首；两首以上时副题换成「已选 N 首 · 共 M 首」。 */
  readonly selected: number;
  readonly queryOpen: boolean;
  readonly onQueryOpenChange: (open: boolean) => void;
}

/**
 * 歌曲页的页头：标题与副题（「N 首 · 总长」，筛着时接「全库 M 首」）；过滤框与分面条开关；播放、随机与 ⋯。
 * 查询有误时保留上次结果并暂停页头操作，错误说明提供查询菜单入口。
 */
export function SongsHeader({ model, selected, queryOpen, onQueryOpenChange }: SongsHeaderProps) {
  const controls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const prefs = useAtomValueRawSync(songsPrefsAtom);
  const { available } = useAtomValueRawSync(playStatsAtom);
  const songs = useService(songsKey);
  const classes = useStyles();
  const input = useRef<HTMLInputElement>(null);
  const [tier, setTier] = useState<HeaderTier>('wide');
  const measure = useElementWidth<HTMLElement>((width) => setTier(tierOf(width)));
  const { rows, library, filter, query, view, run } = model;
  const numbers = new Intl.NumberFormat();
  const count = (n: number) =>
    t(plural(n, 'songs.countOne', 'songs.count'), { count: numbers.format(n) });
  const total = rows.handles.length;
  const libraryTotal = library.byHandle.size;

  const parts: string[] = [];
  if (rows.status === 'failed' || library.status === 'failed') parts.push(t('songs.readFailed'));
  else if (rows.invalid && !model.settled) parts.push(count(0));
  else if (!model.settled) parts.push(t('songs.loading'));
  else if (selected > 1) {
    parts.push(t(plural(selected, 'songs.selectedOne', 'songs.selected'), { count: selected }));
    parts.push(
      t(plural(total, 'songs.ofTotalOne', 'songs.ofTotal'), { count: numbers.format(total) }),
    );
  } else {
    parts.push(count(total));
    const span = spanText(view.duration, t, plural);
    if (span) parts.push(span);
    if (query.filtered) {
      const all = numbers.format(libraryTotal);
      parts.push(t(plural(libraryTotal, 'songs.ofLibraryOne', 'songs.ofLibrary'), { count: all }));
    }
  }
  const playable = model.resultsCurrent && total > 0;
  const first = rows.handles[0];
  const labels = tier === 'wide';
  const facets = songFacetCount(filter.facets);

  return (
    <header ref={measure} className={styles.root} data-tier={tier} data-songs-header>
      <div className={styles.titles}>
        <Title2 as="h1" className={classes.title}>
          {t('songs.title')}
        </Title2>
        <span className={styles.subtitle} title={parts.join(' · ')} data-songs-subtitle>
          {tier === 'narrow' ? parts[0] : parts.join(' · ')}
        </span>
      </div>
      <div className={styles.filter}>
        <div className={tier === 'narrow' ? classes.wideQuery : classes.query}>
          <QueryBox
            inputRef={input}
            input={filter}
            scope={prefs.scope}
            checked={filter.presets}
            playcount={available}
            invalid={rows.invalid && query.raw}
            menuOpen={queryOpen}
            placeholder={t('songs.filterShort')}
            label={t('songs.filter')}
            onChange={songs.filter.setQuery}
            onEnter={() => songs.rows.flush()}
            onScope={(scope) => songs.prefs.setScope(scope)}
            onTogglePreset={(id) => songs.filter.togglePreset(id)}
            onMenuOpenChange={onQueryOpenChange}
          />
        </div>
        <Tooltip content={t('songs.facetsToggle')} relationship="label">
          <ToggleButton
            className={mergeClasses(facets > 0 ? classes.facetsActive : undefined, controls.icon)}
            checked={prefs.facetsOpen}
            icon={<Options20Regular />}
            onClick={() => songs.prefs.setFacetsOpen(!prefs.facetsOpen)}
            data-songs-facets-toggle
            appearance="subtle"
          >
            {facets > 0 ? facets : undefined}
          </ToggleButton>
        </Tooltip>
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
            {labels ? t('songs.play') : undefined}
          </Button>
        </Tooltip>
        <Tooltip content={t('songs.shuffle')} relationship="label">
          <Button
            className={controls.field}
            icon={<ArrowShuffle20Regular />}
            disabled={!playable}
            onClick={() => void songs.actions.play(run, 'shuffle')}
            data-songs-shuffle
          >
            {labels ? t('songs.shuffle') : undefined}
          </Button>
        </Tooltip>
        <SongsMoreMenu model={model} />
      </div>
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
