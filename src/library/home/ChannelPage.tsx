import { Button, Spinner, Tooltip } from '@fluentui/react-components';
import { ArrowClockwise20Regular, Edit20Regular, Play20Filled } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type { PageProps } from '../../nav/places.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { trackNumberText } from '../../table/cellText.ts';
import { createColumnsModel } from '../../table/columns/columnsModel.ts';
import { createRowSelection } from '../../table/rowSelection.ts';
import type { TableArtwork, TableLinks } from '../../table/tableItems.ts';
import { TrackTable, type TrackTableHandle } from '../../table/TrackTable.tsx';
import { useTableSnapshot, type TableView } from '../../table/useTableSnapshot.ts';
import { PrimaryPlayButton } from '../../theme/PrimaryPlayButton.tsx';
import { libraryTracksAtom } from '../libraryTracks.ts';
import { SongArt } from '../songs/SongArt.tsx';
import { buildSongsView } from '../songs/songsView.ts';
import { HomeChannelDialog } from './HomeChannelDialog.tsx';
import { HomeContext, useHomeServices } from './homeContext.ts';
import { useChannelQuery } from './useChannelQuery.ts';
import type { ChannelQueryService } from './channelQuery.ts';
import styles from './ChannelPage.module.css';
import { useService } from '../../kit/useService.ts';
import { albumListKey } from '../album-list/albumList.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';

const CHANNEL_SLOT = createSnapshotSlot<TableView<string>>();

export function ChannelPage({ place }: PageProps) {
  const home = useContext(HomeContext);
  return home ? <ChannelSession key={place.subject} id={place.subject ?? ''} /> : null;
}

function ChannelSession({ id }: { readonly id: string }) {
  const query = useChannelQuery();
  return query ? <ChannelContent id={id} query={query} /> : null;
}
function ChannelContent({
  id,
  query,
}: {
  readonly id: string;
  readonly query: ChannelQueryService;
}) {
  const home = useHomeServices();
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const albumList = useService(albumListKey);
  const albumDetail = useService(albumDetailKey);
  const channels = useAtomValueRawSync(home.channels.state);
  const channel = channels.items.find((item) => item.id === id);
  const result = useAtomValueRawSync(query.state);
  const library = useAtomValueRawSync(libraryTracksAtom);
  const [editing, edit] = useState(false);
  const handle = useRef<TrackTableHandle>(null);
  useEffect(() => {
    albumList.tracks.want();
  }, [query, albumList]);
  useEffect(() => {
    query.setQuery(channel?.query ?? '', channel?.sort ?? 'album', true);
  }, [query, channel?.query, channel?.sort]);
  const view = useMemo(
    () =>
      buildSongsView(
        result.tracks.flatMap((track) => track.handle ?? []),
        library.byHandle,
        null,
      ),
    [result.tracks, library.byHandle],
  );
  const [columns] = useState(() =>
    createColumnsModel(store, {
      key: 'default-theme.channel-columns.v1',
      offered: ['status', 'art', 'title', 'artist', 'album', 'duration', 'rating'],
      compact: { width: 650, columns: ['album'] },
    }),
  );
  const [selection] = useState(() => createRowSelection(store, { total: 0 }));
  useEffect(() => {
    selection.clear();
    selection.setTotal(view.items.length);
  }, [selection, view.items]);
  const artwork = useCallback<TableArtwork>(
    (track, size) => <SongArt album={albumDetail.findAlbum(track) ?? undefined} size={size} />,
    [albumDetail],
  );
  const links = useMemo<TableLinks>(
    () => ({
      album: (track) => {
        const album = albumDetail.findAlbum(track);
        if (album) albumDetail.open(album);
      },
    }),
    [albumDetail],
  );
  useTableSnapshot(CHANNEL_SLOT, {
    handle,
    items: view.items,
    ready: result.status === 'ready' && library.status === 'ready',
    extra: () => id,
  });
  const tracks = view.items.flatMap((_, index) => view.trackAt(index) ?? []);
  const play = (index: number) => {
    if (channel && home.playChannel && tracks.length === view.items.length)
      void home.playChannel(channel, tracks, index);
  };
  if (channels.status === 'loading') return <Spinner size="tiny" label={t('album.loading')} />;
  if (channels.status === 'failed')
    return (
      <section>
        <p role="alert">{t('home.channelsFailed')}</p>
        <Button onClick={() => void home.channels.retry()}>{t('album.retry')}</Button>
      </section>
    );
  if (!channel) return <p>{t('home.channelMissing')}</p>;
  const failed =
    result.status === 'failed' || result.status === 'unavailable' || library.status === 'failed';
  return (
    <section className={styles.root} data-page="channel" aria-label={channel.name}>
      <header className={styles.header}>
        <h1>{channel.name}</h1>
        <div className={styles.tools}>
          <Tooltip
            content={t(home.playChannel ? 'album.play' : 'home.channelPlayUnavailable')}
            relationship="description"
          >
            <PrimaryPlayButton
              icon={<Play20Filled />}
              disabledFocusable={!home.playChannel || !tracks.length}
              onClick={() => play(0)}
            >
              {t('album.play')}
            </PrimaryPlayButton>
          </Tooltip>
          <Button
            icon={<ArrowClockwise20Regular />}
            onClick={() => {
              query.retry();
              if (library.status === 'failed') void albumList.tracks.retry();
            }}
          >
            {t('home.refresh')}
          </Button>
          <Tooltip content={t('home.editChannel')} relationship="label">
            <Button
              icon={<Edit20Regular />}
              aria-label={t('home.editChannel')}
              onClick={() => edit(true)}
            />
          </Tooltip>
        </div>
      </header>
      <div className={styles.status} aria-live="polite">
        {result.status === 'ready' && (
          <span>{t('home.previewCount', { count: result.total })}</span>
        )}
        {result.total > result.tracks.length && result.status === 'ready' && (
          <span>
            {t('home.channelLimit', { shown: result.tracks.length, total: result.total })}
          </span>
        )}
        {result.dirty && <span>{t('home.changed')}</span>}
        {failed && <span role="alert">{t('home.queryFailed')}</span>}
        {result.status === 'disabled' && <span>{t('album.disabledTitle')}</span>}
      </div>
      <div className={styles.table}>
        <TrackTable
          handle={handle}
          columns={columns}
          selection={selection}
          label={channel.name}
          items={view.items}
          rowHeight={44}
          ratingStamp={library.stamp}
          numberText={trackNumberText}
          artwork={artwork}
          links={links}
          loading={result.status === 'loading' || library.status === 'loading'}
          empty={result.status === 'ready' ? t('home.previewEmpty') : null}
          onPlay={play}
        />
      </div>
      {editing && <HomeChannelDialog channel={channel} onClose={() => edit(false)} />}
    </section>
  );
}
