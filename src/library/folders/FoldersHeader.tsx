import {
  Button,
  Link,
  Title2,
  ToggleButton,
  Tooltip,
  makeStyles,
} from '@fluentui/react-components';
import {
  ArrowShuffle20Regular,
  MoreHorizontal20Regular,
  Options20Regular,
  Play20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useElementWidth } from '../../kit/useElementWidth.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { QueryBox } from '../../track/QueryBox.tsx';
import { playStatsAtom } from '../playStats.ts';
import type { FoldersTarget } from './actions/foldersActions.ts';
import type { FoldersView } from './detail/useFoldersView.ts';
import styles from './FoldersHeader.module.css';
import { useService } from '../../kit/useService.ts';
import { foldersKey } from './foldersServices.ts';

const useStyles = makeStyles({
  title: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});
export interface FoldersHeaderProps {
  readonly model: FoldersView;
  onMenu(target: FoldersTarget, point: TablePoint): void;
}
export function FoldersHeader({ model, onMenu }: FoldersHeaderProps) {
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const { available } = useAtomValueRawSync(playStatsAtom);
  const classes = useStyles();
  const input = useRef<HTMLInputElement>(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const [width, setWidth] = useState(1000);
  const measure = useElementWidth<HTMLElement>(setWidth);
  const { preview, results, prefs, conditions, structure, playable } = model;
  const title =
    preview.nodes.length > 1
      ? t('folders.selected', { count: preview.nodes.length })
      : (preview.node?.name ?? t('folders.title'));
  const tier = width < 560 ? 'narrow' : width < 880 ? 'medium' : 'wide';
  const directoryCount =
    model.full.groups.length === 1
      ? (model.full.groups[0]?.children.length ?? 0)
      : model.full.groups.length;
  const count =
    preview.status === 'loading' || results.status === 'loading'
      ? t('folders.loading')
      : results.filtered
        ? t('folders.matches', { count: results.tracks.length, total: results.total })
        : t('folders.summary', {
            directories: directoryCount,
            count: preview.status === 'ready' ? results.total : (preview.node?.count ?? 0),
          });
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
  const playLabel = t(results.filtered ? 'folders.playResults' : 'folders.play');
  return (
    <header ref={measure} className={styles.root} data-tier={tier}>
      <div className={styles.titles}>
        <Title2 as="h1" className={classes.title} title={title}>
          {title}
        </Title2>
        <span className={styles.count} title={count}>
          {count}
        </span>
      </div>
      <div className={styles.filter}>
        <div className={styles.query}>
          <QueryBox
            inputRef={input}
            input={conditions}
            scope={prefs.scope}
            checked={conditions.presets}
            playcount={available}
            invalid={results.invalid}
            menuOpen={queryOpen}
            onMenuOpenChange={setQueryOpen}
            label={t('folders.resultFilter')}
            placeholder={t('folders.resultFilterShort')}
            onChange={folders.results.setQuery}
            onEnter={folders.results.flush}
            onScope={(scope) => folders.prefs.change({ scope })}
            onTogglePreset={folders.results.togglePreset}
          />
        </div>
        <Tooltip content={t('folders.facets')} relationship="label">
          <ToggleButton
            checked={prefs.facetsOpen}
            icon={<Options20Regular />}
            onClick={() => folders.prefs.change({ facetsOpen: !prefs.facetsOpen })}
          />
        </Tooltip>
      </div>
      <div className={styles.actions}>
        <Tooltip content={playLabel} relationship="label">
          <Button
            appearance="primary"
            icon={<Play20Regular />}
            disabled={!playable}
            onClick={() => play(false)}
          >
            {tier === 'wide' ? playLabel : undefined}
          </Button>
        </Tooltip>
        <Tooltip content={t('folders.shuffle')} relationship="label">
          <Button icon={<ArrowShuffle20Regular />} disabled={!playable} onClick={() => play(true)}>
            {tier === 'wide' ? t('folders.shuffle') : undefined}
          </Button>
        </Tooltip>
        <Tooltip content={t('folders.more')} relationship="label">
          <Button
            appearance="transparent"
            icon={<MoreHorizontal20Regular />}
            disabled={!playable}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onMenu(target, { x: rect.x, y: rect.bottom });
            }}
          />
        </Tooltip>
      </div>
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
          <Button size="small" onClick={folders.results.flush}>
            {t('folders.retry')}
          </Button>
        </div>
      )}
    </header>
  );
}
