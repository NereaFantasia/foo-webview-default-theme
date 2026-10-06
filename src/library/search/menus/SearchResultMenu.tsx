import { BookOpen20Regular, Library20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import { pluralAtom } from '../../../i18n/plural.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { TrackContextMenu } from '../../../track/TrackContextMenu.tsx';
import { divider, type TrackMenuItem } from '../../../track/trackMenuEntries.ts';
import { useTrackMenuRating } from '../../../track/useTrackMenuRating.ts';
import { albumAutoplaylistQuery } from '../../albumTracks.ts';
import { MENU_HANDLES_LIMIT, UNION_ALBUM_LIMIT, UNION_TRACK_LIMIT } from '../../albumMenu.ts';
import { albumArtistOf } from '../../../host/libraryContract.ts';
import { useSearchSession } from '../searchContext.ts';
import { searchHitKey } from '../searchQuery.ts';
import type { SearchMenuService } from './searchMenu.ts';
import { useService } from '../../../kit/useService.ts';
import { LIBRARY_SOURCE } from '../../../playback/playbackSource.ts';
import { pathHandlers, trackActionsKey } from '../../../track/trackActions.ts';
import { albumDetailKey } from '../../album-detail/albumDetail.ts';
import { ratingsKey } from '../../../track/trackRatings.ts';

interface SearchResultMenuProps {
  readonly menu: SearchMenuService;
  readonly at: TablePoint | null;
  readonly text: string;
  onClose(): void;
}
export function SearchResultMenu({ menu, at, text, onClose }: SearchResultMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const session = useSearchSession();
  const trackActions = useService(trackActionsKey);
  const albumDetail = useService(albumDetailKey);
  const ratings = useService(ratingsKey);
  const state = useAtomValueRawSync(menu.state);
  const { hit, hits, tracks, paths, targets, tree } = state;
  const single = hits.length === 1 ? hit : null;
  const albums = hits.flatMap((item) => (item.kind === 'album' ? [item.album] : []));
  const albumSelection = albums.length > 0 && albums.length === hits.length;
  const trackSelection = hits.length > 0 && albums.length === 0;
  const rating = useTrackMenuRating(
    t,
    ratings,
    tracks.length === paths.length ? tracks : [],
    state.stamp,
    !!at && trackSelection,
  );
  const title = single
    ? single.kind === 'album'
      ? single.album.name
      : single.track.title || single.track.path || ''
    : albumSelection
      ? t('album.menuAlbums', { count: hits.length })
      : t(plural(hits.length, 'album.menuTracksOne', 'album.menuTracks'), { count: hits.length });
  const usable = !state.loading && !state.failed && !state.limited && !!paths.length;
  const album = hit?.kind === 'track' ? albumDetail.findAlbum(hit.track) : null;
  const items: TrackMenuItem[] = [
    ...(single?.kind === 'album'
      ? [
          {
            kind: 'command' as const,
            id: 'open-detail',
            label: t('album.openDetail'),
            icon: <BookOpen20Regular />,
            onSelect: () => session.activate(single, text),
          },
          divider('detail-divider'),
        ]
      : []),
    'play',
    'play-next',
    'enqueue',
    divider('send-divider'),
    'send-to',
    ...(albumSelection
      ? [
          {
            kind: 'command' as const,
            id: 'autoplaylist',
            label: t(single ? 'album.autoplaylistOne' : 'album.autoplaylistMany'),
            icon: <Library20Regular />,
            disabled: !albumAutoplaylistQuery(albums),
            onSelect: () => void menu.createAutoplaylist(),
          },
        ]
      : trackSelection
        ? [
            divider('navigation-divider'),
            'go-to-album' as const,
            divider('rating-divider'),
            'rating' as const,
          ]
        : []),
    ...(state.loading || state.failed || state.limited
      ? [
          {
            kind: 'status' as const,
            id: 'read-status',
            label: state.limited
              ? t('album.menuLimited', { albums: UNION_ALBUM_LIMIT, tracks: UNION_TRACK_LIMIT })
              : t(state.failed ? 'album.menuTracksFailed' : 'album.loading'),
          },
        ]
      : []),
    ...(state.failed && hit
      ? [
          {
            kind: 'command' as const,
            id: 'retry',
            label: t('album.retry'),
            onSelect: () => void menu.open(hit, hits),
            keepOpen: true,
          },
        ]
      : []),
    divider('properties-divider'),
    'properties',
    'more-commands',
  ];
  return (
    <TrackContextMenu
      at={hit ? at : null}
      targetKey={JSON.stringify(hits.map(searchHitKey))}
      title={title}
      subtitle={single?.kind === 'album' ? albumArtistOf(single.album) : single?.track.artist}
      surfaceAttributes={{ 'data-search-menu': true }}
      isCurrent={menu.isCurrent}
      items={items}
      usable={usable}
      multiple={hits.length > 1}
      targets={targets}
      handlers={{
        ...pathHandlers(trackActions, paths, title, LIBRARY_SOURCE),
        ...(single ? { play: () => session.activate(single, text, true) } : {}),
      }}
      album={{ open: hit && album ? () => session.activate(hit, text) : null, here: false }}
      rating={rating}
      tree={tree}
      runCommand={(node) => void trackActions.runCommandIn(tree, node)}
      treeLimited={paths.length > MENU_HANDLES_LIMIT}
      retryTree={usable ? () => void menu.retry() : undefined}
      onClose={() => {
        menu.close();
        onClose();
      }}
    />
  );
}
