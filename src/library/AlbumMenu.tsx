import { BookOpen20Regular, Library20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { durationText } from '../table/cellText.ts';
import { TrackContextMenu } from '../track/TrackContextMenu.tsx';
import { divider, type TrackMenuItem } from '../track/trackMenuEntries.ts';
import { useTrackMenuRating } from '../track/useTrackMenuRating.ts';
import {
  albumMenuAtom,
  MENU_HANDLES_LIMIT,
  UNION_ALBUM_LIMIT,
  UNION_TRACK_LIMIT,
  type MenuPoint,
} from './albumMenu.ts';
import { albumArtistOf, albumKeyOf, trackPathOf } from '../host/libraryContract.ts';
import { AlbumColorTheme } from './AlbumColorTheme.tsx';
import { useService } from '../kit/useService.ts';
import { pathHandlers, trackActionsKey } from '../track/trackActions.ts';
import { LIBRARY_SOURCE } from '../playback/playbackSource.ts';
import { albumSource } from './albumActions.ts';
import { albumsKey } from './albumServices.ts';
import { albumDetailKey } from './album-detail/albumDetail.ts';
import { ratingsKey } from '../track/trackRatings.ts';

const CAPTION_NAMES = 3;

export interface AlbumMenuProps {
  readonly at: MenuPoint | null;
  readonly onClose: () => void;
}

export function AlbumMenu({ at, onClose }: AlbumMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const menu = useAtomValueRawSync(albumMenuAtom);
  const { place } = useAtomValueRawSync(historyAtom);
  const albums = useService(albumsKey);
  const trackActions = useService(trackActionsKey);
  const albumDetail = useService(albumDetailKey);
  const ratings = useService(ratingsKey);
  const open = at !== null;
  useEffect(() => {
    if (open) return () => albums.menu.close();
  }, [open, albums]);
  const single = menu.albums.length === 1 ? menu.albums[0] : undefined;
  const track = menu.trackIndex !== null ? menu.tracks[0] : undefined;
  const multipleTracks = !!track && menu.tracks.length > 1;
  const rating = useTrackMenuRating(t, ratings, menu.tracks, menu.ratingStamp, open && !!track);
  const here = single && place.id === 'album' && place.subject === albumKeyOf(single);
  const usable = !menu.loading && !menu.limited && !menu.failed && menu.tracks.length > 0;
  const trackCount = track
    ? menu.tracks.length
    : menu.albums.reduce((sum, album) => sum + album.trackCount, 0);
  const count = t(plural(trackCount, 'album.menuTracksOne', 'album.menuTracks'), {
    count: trackCount,
  });
  const names = menu.albums
    .slice(0, CAPTION_NAMES)
    .map((album) => album.name)
    .join(t('album.nameSeparator'));
  let meta = single
    ? `${albumArtistOf(single)} · ${count}`
    : `${names}${menu.albums.length > CAPTION_NAMES ? '…' : ''} · ${count}`;
  if (track)
    meta = multipleTracks
      ? (single?.name ?? '')
      : [track.artist, durationText(track.duration)].filter(Boolean).join(' · ');
  if (menu.limited)
    meta = t('album.menuLimited', { albums: UNION_ALBUM_LIMIT, tracks: UNION_TRACK_LIMIT });
  else if (menu.failed) meta = t('album.menuTracksFailed');
  const paths = menu.tracks.map(trackPathOf);
  const items: TrackMenuItem[] = [
    ...(single && !track && !here
      ? [
          {
            kind: 'command' as const,
            id: 'open-detail',
            label: t('album.openDetail'),
            icon: <BookOpen20Regular />,
            onSelect: () => albumDetail.open(single),
          },
          divider('detail-divider'),
        ]
      : []),
    'play',
    'play-next',
    'enqueue',
    divider('send-divider'),
    'send-to',
    ...(track
      ? [
          divider('navigation-divider'),
          'go-to-album' as const,
          divider('rating-divider'),
          'rating' as const,
        ]
      : [
          {
            kind: 'command' as const,
            id: 'create-autoplaylist',
            label: t(single ? 'album.autoplaylistOne' : 'album.autoplaylistMany'),
            icon: <Library20Regular />,
            disabled: !menu.canCreateAutoplaylist,
            onSelect: () => void albums.actions.createAutoplaylist(),
          },
        ]),
    divider('properties-divider'),
    'properties',
    'more-commands',
  ];
  return (
    <AlbumColorTheme album={open ? (single ?? null) : null}>
      <TrackContextMenu
        at={at}
        surfaceAttributes={{ 'data-album-menu': true }}
        targetKey={JSON.stringify([menu.albums.map(albumKeyOf), menu.trackIndex, track && paths])}
        title={
          track
            ? multipleTracks
              ? count
              : track.title || track.path
            : single
              ? single.name
              : t('album.menuAlbums', { count: menu.albums.length })
        }
        subtitle={meta}
        items={items}
        usable={usable}
        multiple={multipleTracks || menu.albums.length > 1}
        targets={menu.targets}
        handlers={{
          ...pathHandlers(
            trackActions,
            paths,
            '',
            single && !track ? albumSource(single) : LIBRARY_SOURCE,
          ),
          sendToNew: () => void albums.actions.sendToNew(),
        }}
        album={{ open: single ? () => albumDetail.open(single) : null, here: !!here }}
        rating={track ? rating : undefined}
        tree={menu.tree}
        runCommand={(node) => void trackActions.runCommandIn(menu.tree, node)}
        treeLimited={menu.limited || menu.tracks.length > MENU_HANDLES_LIMIT}
        retryTree={!menu.failed && menu.tracks.length ? () => void albums.menu.retry() : undefined}
        onClose={() => {
          albums.menu.close();
          onClose();
        }}
      />
    </AlbumColorTheme>
  );
}
