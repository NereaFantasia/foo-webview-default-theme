import { Button, Dropdown, Option, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import { Play20Filled, ArrowShuffle20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useState, type RefObject } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { rowsOf } from '../../table/rangeSelection.ts';
import { TrackTable, type TrackTableHandle } from '../../table/TrackTable.tsx';
import type { TablePoint, TableTrack } from '../../table/tableItems.ts';
import { TrackMenu } from '../TrackMenu.tsx';
import { AlbumMenu } from '../AlbumMenu.tsx';
import { SongArt } from '../songs/SongArt.tsx';
import { GenreGroupHead } from './GenreGroupHead.tsx';
import { GenresMenu } from './GenresMenu.tsx';
import { genresQuery, type GenreEntry } from './genresModel.ts';
import { genreKeys, genreName } from './genresSubject.ts';
import { GENRE_GROUPS, isGenreGrouping } from './genresPrefs.ts';
import { GENRE_GROUP_HEIGHT, GENRE_ROW_HEIGHT, type GenreGroup } from './genresGroups.ts';
import { useGenresTable } from './useGenresTable.ts';
import styles from './GenresDetail.module.css';
import { useService } from '../../kit/useService.ts';
import { genresKey } from './genresServices.ts';
import { albumListKey } from '../album-list/albumList.ts';
import { albumsKey } from '../albumServices.ts';

const useStyles = makeStyles({
  actions: { flexShrink: 0 },
  group: { minWidth: '120px' },
  warning: { color: tokens.colorNeutralForeground3 },
});
export interface GenresDetailProps {
  readonly entry: GenreEntry;
  readonly closed: ReadonlySet<string>;
  readonly setClosed: (closed: ReadonlySet<string>) => void;
  readonly scroll: RefObject<HTMLDivElement | null>;
  readonly handle: RefObject<TrackTableHandle | null>;
}
const groupHeight = () => GENRE_GROUP_HEIGHT;
const numberText = (track: TableTrack) => String(track.trackNumber || '');

export function GenresDetail(props: GenresDetailProps) {
  const t = useAtomValueRawSync(translateAtom);
  const genres = useService(genresKey);
  const albumList = useService(albumListKey);
  const albums = useService(albumsKey);
  const classes = useStyles();
  const model = useGenresTable(props.closed);
  const { entry } = props;
  const name = genreName(entry.key, t);
  const keys = genreKeys(entry.key);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [at, setAt] = useState<TablePoint | null>(null);
  const [albumAt, setAlbumAt] = useState<TablePoint | null>(null);
  const [menuGroup, setMenuGroup] = useState<GenreGroup | null>(null);
  const [menuRows, setMenuRows] = useState(model.rows.tracks);
  const scroll = props.scroll;
  const setScroll = useCallback(
    (element: HTMLDivElement | null) => {
      scroll.current = element;
      setScroller(element);
    },
    [scroll],
  );
  const current = model.rows.key === entry.key;
  const ready = current && model.rows.status === 'ready';
  const playable = ready && model.rows.fill !== null && model.rows.tracks.length > 0;
  const toggle = (index: number, value?: boolean) => {
    const item = model.items[index];
    if (item?.kind !== 'group') return;
    const next = new Set(props.closed);
    if (value ?? !next.has(item.key)) next.add(item.key);
    else next.delete(item.key);
    props.setClosed(next);
  };
  const play = (row: number) => {
    const track = model.rows.tracks[row];
    if (playable && track && model.rows.fill)
      void genres.actions.play(keys, name, { row, handle: track.handle }, model.rows.fill);
  };
  return (
    <div ref={setScroll} className={styles.root}>
      <header className={styles.header}>
        <div className={styles.mosaic} aria-hidden>
          {Array.from({ length: 4 }, (_, index) => (
            <SongArt key={index} album={entry.albums[index]} size={32} />
          ))}
        </div>
        <div className={styles.summary}>
          <h2 className={styles.title}>{name}</h2>
          <div className={styles.count}>
            {t('genres.counts', { albums: entry.albumCount, tracks: entry.tracks.length })} ·{' '}
            {Math.floor(entry.duration / 3600)}:
            {String(Math.floor(entry.duration / 60) % 60).padStart(2, '0')}:
            {String(Math.floor(entry.duration) % 60).padStart(2, '0')}
          </div>
          <div className={styles.artists} title={entry.artists.join(' · ')}>
            {entry.artists.join(' · ')}
          </div>
        </div>
        <div className={styles.actions}>
          <Button
            className={classes.actions}
            appearance="primary"
            icon={<Play20Filled />}
            disabled={!playable}
            onClick={() => play(0)}
          >
            {t('genres.play')}
          </Button>
          <Button
            className={classes.actions}
            icon={<ArrowShuffle20Regular />}
            disabled={!playable}
            onClick={() =>
              void genres.actions.play(keys, name, 'shuffle', model.rows.fill ?? undefined)
            }
          >
            {t('genres.shuffle')}
          </Button>
          <GenresMenu keys={keys} />
        </div>
      </header>
      {genresQuery(keys) === null && <p className={classes.warning}>{t('genres.unsupported')}</p>}
      <div className={styles.tools}>
        <Dropdown
          className={classes.group}
          size="small"
          value={t(`genres.group.${model.group}`)}
          selectedOptions={[model.group]}
          aria-label={t('genres.group')}
          onOptionSelect={(_, data) => {
            if (isGenreGrouping(data.optionValue)) {
              props.setClosed(new Set());
              genres.prefs.update({ group: data.optionValue });
            }
          }}
        >
          {GENRE_GROUPS.map((mode) => (
            <Option key={mode} value={mode}>
              {t(`genres.group.${mode}`)}
            </Option>
          ))}
        </Dropdown>
        <Button
          size="small"
          appearance="subtle"
          disabled={model.groups.length === 0}
          onClick={() => props.setClosed(new Set())}
        >
          {t('genres.expand')}
        </Button>
        <Button
          size="small"
          appearance="subtle"
          disabled={model.groups.length === 0}
          onClick={() => props.setClosed(new Set(model.groups.map((group) => group.key)))}
        >
          {t('genres.collapse')}
        </Button>
        <Button
          size="small"
          appearance="subtle"
          disabled={genresQuery(keys) === null}
          onClick={() => genres.actions.openSongs(keys)}
        >
          {t('genres.openSongs')}
        </Button>
      </div>
      {current && model.rows.status === 'failed' && (
        <div role="alert" className={styles.notice}>
          {t('genres.rowsFailed')}
          <Button onClick={() => void genres.rows.retry()}>{t('genres.retry')}</Button>
        </div>
      )}
      {(!current || model.rows.status === 'loading') && (
        <Spinner size="small" label={t('genres.loading')} />
      )}
      {current && (
        <TrackTable
          handle={props.handle}
          columns={model.columns}
          items={model.items}
          selection={model.selection}
          label={t('genres.table')}
          rowHeight={GENRE_ROW_HEIGHT}
          groupHeight={groupHeight}
          groupFocus
          animateGroupFold={() => true}
          ratingStamp={model.rows.stamp}
          numberText={numberText}
          links={model.links}
          scrollParent={scroller}
          loading={model.rows.status === 'loading'}
          renderGroup={(item, state) => (
            <GenreGroupHead
              item={item}
              state={state}
              coverWidth={model.coverWidth}
              onAlbumMenu={(point) => {
                if (!item.data.album) return;
                void albums.menu.prepare([item.data.album]);
                setAlbumAt(point);
              }}
            />
          )}
          onToggleGroup={(index) => toggle(index)}
          onSetGroup={toggle}
          onExpandSiblings={() => props.setClosed(new Set())}
          onGroupClick={(index, modifiers, toggleGroup) => {
            const item = model.items[index];
            if (item?.kind !== 'group') return;
            if (modifiers.ctrl || modifiers.shift)
              model.selection.selectSpan(item.data.start, item.data.end, modifiers);
            else toggleGroup();
          }}
          rank={(item, needle) =>
            item.kind === 'row' && item.track?.title.toLocaleLowerCase().startsWith(needle)
              ? 0
              : undefined
          }
          onPlay={(index) => {
            const item = model.items[index];
            if (item?.kind === 'row') play(item.order);
            else if (item?.kind === 'group') play(item.data.start);
          }}
          onMenu={(target, point) => {
            setMenuRows(model.rows.tracks);
            if (target.kind === 'group') {
              const item = model.items[target.index];
              if (item?.kind === 'group') {
                const group = item.data;
                const tracks = model.rows.tracks.slice(group.start, group.end);
                if (!tracks.length) return;
                void albumList.menu.prepare(tracks, undefined, model.rows.stamp);
                setMenuGroup(group);
                setAt(point);
              }
              return;
            }
            const tracks = rowsOf(target.rows).flatMap((index) => model.rows.tracks[index] ?? []);
            if (tracks.length === 0) return;
            const item = model.items[target.index];
            setMenuGroup(null);
            void albumList.menu.prepare(
              tracks,
              item?.kind === 'row' ? model.rows.tracks[item.order] : undefined,
              model.rows.stamp,
            );
            setAt(point);
          }}
        />
      )}
      <TrackMenu
        at={at}
        onClose={() => setAt(null)}
        isCurrent={() =>
          menuRows === model.rows.tracks &&
          (!menuGroup || model.groups.some((group) => group.key === menuGroup.key))
        }
        group={
          menuGroup
            ? {
                label:
                  menuGroup.disc !== null
                    ? t('genres.disc', { number: menuGroup.disc })
                    : menuGroup.label || t('genres.missingGroup'),
                collapsed: props.closed.has(menuGroup.key),
                toggle: () => {
                  props.handle.current?.toggleGroup(menuGroup.key);
                },
                expandSiblings: () => {
                  const parent = model.groups.find(
                    (group) =>
                      group.disc === null &&
                      group.start <= menuGroup.start &&
                      group.end >= menuGroup.end,
                  );
                  const next = new Set(props.closed);
                  for (const group of model.groups)
                    if (
                      menuGroup.disc === null
                        ? group.disc === null
                        : group.disc !== null &&
                          parent &&
                          group.start >= parent.start &&
                          group.end <= parent.end
                    )
                      next.delete(group.key);
                  props.setClosed(next);
                },
              }
            : undefined
        }
      />
      <AlbumMenu at={albumAt} onClose={() => setAlbumAt(null)} />
    </div>
  );
}
