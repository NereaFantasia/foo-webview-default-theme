import {
  ArrowShuffle20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { historyAtom } from '../nav/navHistory.ts';
import type { TablePoint } from '../table/tableItems.ts';
import { TrackContextMenu } from '../track/TrackContextMenu.tsx';
import { divider, type TrackMenuItem } from '../track/trackMenuEntries.ts';
import { useTrackMenuRating } from '../track/useTrackMenuRating.ts';
import { spanText, totalSeconds } from '../track/trackSpan.ts';
import { MENU_HANDLES_LIMIT } from './albumMenu.ts';
import { albumsAtom } from './albums.ts';
import { albumKeyOf, trackAlbumKeyOf, trackPathOf } from '../host/libraryContract.ts';
import { trackMenuAtom } from './trackMenu.ts';
import { useService } from '../kit/useService.ts';
import { LIBRARY_SOURCE } from '../playback/playbackSource.ts';
import { pathHandlers, trackActionsKey } from '../track/trackActions.ts';
import { albumDetailKey } from './album-detail/albumDetail.ts';
import { albumListKey } from './album-list/albumList.ts';
import { ratingsKey } from '../track/trackRatings.ts';

export interface TrackMenuProps {
  readonly at: TablePoint | null;
  readonly onClose: () => void;
  readonly goToAlbum?: boolean;
  readonly isCurrent?: () => boolean;
  readonly group?: {
    readonly label: string;
    readonly collapsed: boolean;
    readonly toggle: () => void;
    readonly expandSiblings: () => void;
  };
}

export function TrackMenu({ at, onClose, goToAlbum = true, isCurrent, group }: TrackMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const menu = useAtomValueRawSync(trackMenuAtom);
  const { albums: library } = useAtomValueRawSync(albumsAtom);
  const { place } = useAtomValueRawSync(historyAtom);
  const trackActions = useService(trackActionsKey);
  const albumDetail = useService(albumDetailKey);
  const albumList = useService(albumListKey);
  const ratings = useService(ratingsKey);
  const open = at !== null;
  useEffect(() => {
    if (open) return () => albumList.menu.close();
  }, [open, albumList]);
  const { tracks, anchor } = menu;
  const rating = useTrackMenuRating(t, ratings, tracks, menu.ratingStamp, open);
  const paths = tracks.map(trackPathOf);
  const single = tracks.length === 1 ? tracks[0] : undefined;
  const anchorKey = anchor ? trackAlbumKeyOf(anchor) : null;
  const anchorAlbum = library.find(
    (album) => anchorKey !== null && albumKeyOf(album) === anchorKey,
  );
  const count = t(plural(tracks.length, 'trackMenu.selectedOne', 'trackMenu.selected'), {
    count: tracks.length,
  });
  const artists = new Set(tracks.map((track) => track.artist));
  const meta = single
    ? single.artist
    : [artists.size === 1 ? tracks[0]?.artist : '', spanText(totalSeconds(tracks), t, plural)]
        .filter(Boolean)
        .join(' · ');
  const first = tracks[0];
  const batchName =
    new Set(tracks.map((track) => track.album)).size === 1 && first?.album
      ? first.album
      : t('trackMenu.batchName', {
          first: first?.title ?? '',
          count: tracks.length,
          rest: Math.max(0, tracks.length - 1),
        });
  const items: TrackMenuItem[] = group
    ? [
        { action: 'play', label: t('context.playGroup') },
        {
          kind: 'command',
          id: 'shuffle-group',
          label: t('context.shuffleGroup'),
          icon: <ArrowShuffle20Regular />,
          disabled: !paths.length,
          onSelect: () =>
            void trackActions.playPaths(
              paths,
              Math.floor(Math.random() * paths.length),
              LIBRARY_SOURCE,
            ),
        },
        'play-next',
        'enqueue',
        divider('send-divider'),
        'send-to',
        divider('properties-divider'),
        'rating',
        'properties',
        'more-commands',
        divider('group-divider'),
        {
          kind: 'command',
          id: 'toggle-group',
          label: t(group.collapsed ? 'context.expandGroup' : 'context.collapseGroup'),
          icon: group.collapsed ? <ChevronRight20Regular /> : <ChevronDown20Regular />,
          onSelect: group.toggle,
        },
        {
          kind: 'command',
          id: 'expand-siblings',
          label: t('context.expandSiblings'),
          icon: <ChevronDown20Regular />,
          onSelect: group.expandSiblings,
        },
      ]
    : [
        'play',
        'play-next',
        'enqueue',
        divider('send-divider'),
        'send-to',
        ...(goToAlbum ? [divider('navigation-divider'), 'go-to-album' as const] : []),
        divider('properties-divider'),
        'rating',
        'properties',
        'more-commands',
      ];
  return (
    <TrackContextMenu
      at={at}
      isCurrent={isCurrent}
      surfaceAttributes={{ 'data-track-menu': true }}
      targetKey={JSON.stringify([tracks.map((track) => track.handle), anchor?.handle])}
      title={group?.label ?? (single ? single.title || single.path : count)}
      subtitle={
        group
          ? count
          : !single && anchor
            ? [meta, t('context.clickedTitle', { title: anchor.title || anchor.path })]
                .filter(Boolean)
                .join(' · ')
            : meta
      }
      items={items}
      usable={paths.length > 0}
      multiple={tracks.length > 1}
      targets={menu.targets}
      handlers={pathHandlers(trackActions, paths, batchName, LIBRARY_SOURCE)}
      album={{
        open: anchorAlbum ? () => albumDetail.open(anchorAlbum) : null,
        here: place.id === 'album' && place.subject === anchorKey,
      }}
      rating={rating}
      tree={menu.tree}
      runCommand={(node) => void trackActions.runCommandIn(menu.tree, node)}
      treeLimited={tracks.length > MENU_HANDLES_LIMIT}
      retryTree={() => void albumList.menu.retry()}
      onClose={() => {
        albumList.menu.close();
        onClose();
      }}
    />
  );
}
