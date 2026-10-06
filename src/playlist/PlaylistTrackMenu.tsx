import { Button, MessageBar, MessageBarActions, MessageBarBody } from '@fluentui/react-components';
import {
  Crop20Regular,
  Delete20Regular,
  Dismiss20Regular,
  Filter20Regular,
  Play20Regular,
} from '@fluentui/react-icons';
import type { MenuCommand } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useRef, useState } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { ratingValueOf } from '../host/contextMenu.ts';
import { countRows, rowsOf, type SelectionRanges } from '../table/rangeSelection.ts';
import type { TablePoint } from '../table/tableItems.ts';
import { TrackContextMenu } from '../track/TrackContextMenu.tsx';
import { divider, hostRatingEntry, type TrackMenuItem } from '../track/trackMenuEntries.ts';
import { useTrackMenuRating } from '../track/useTrackMenuRating.ts';
import type { PlaylistMenuTracks } from './playlistMenuTracks.ts';
import { usePlaylistMenuTracks } from './usePlaylistMenuTracks.ts';
import { conditionChoices, type ConditionField } from './filter/playlistMatch.ts';
import { playlistsAtom } from '../playback/playlists.ts';
import { SEND_TO_INLINE_LIMIT } from './playlistTrackActions.ts';
import type { PlaylistView } from './playlistView.ts';
import { playPlaylistSelection } from './playPlaylistSelection.ts';
import { useService } from '../kit/useService.ts';
import { LIBRARY_SOURCE } from '../playback/playbackSource.ts';
import { trackActionsKey } from '../track/trackActions.ts';
import { playlistPageKey } from './playlistPageServices.ts';
import { playlistActionsKey } from './playlistActions.ts';
import { playlistRowsKey } from './playlistRows.ts';
import { albumNavigationKey } from '../track/albumNavigation.ts';
import { ratingsKey } from '../track/trackRatings.ts';

export interface PlaylistMenuTarget {
  readonly at: TablePoint;
  readonly ranges: SelectionRanges;
  readonly row: number;
  readonly contentVersion: number;
  readonly ratingTracks: PlaylistMenuTracks | null;
}

export interface PlaylistTrackMenuProps {
  readonly guid: string;
  readonly target: PlaylistMenuTarget | null;
  readonly view: PlaylistView;
  readonly total: number;
  readonly onClose: () => void;
  readonly isCurrent?: () => boolean;
}

const FILTER_LABELS: Record<ConditionField, MessageKey> = {
  artist: 'playlistPage.filterArtist',
  album: 'playlistPage.filterAlbum',
  genre: 'playlistPage.filterGenre',
  year: 'playlistPage.filterYear',
};

export function PlaylistTrackMenu({
  guid,
  target,
  view,
  total,
  onClose,
  isCurrent,
}: PlaylistTrackMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const store = useStore();
  const page = useService(playlistPageKey);
  const playlistActions = useService(playlistActionsKey);
  const playlistRows = useService(playlistRowsKey);
  const trackActions = useService(trackActionsKey);
  const albumNavigation = useService(albumNavigationKey);
  const ratings = useService(ratingsKey);
  useAtomValueRawSync(albumNavigation.catalog);
  const selectedTracks = usePlaylistMenuTracks(guid, target);
  const directRating = useTrackMenuRating(
    t,
    ratings,
    selectedTracks.tracks,
    selectedTracks.stamps,
    target !== null,
  );
  const rating = selectedTracks.failed
    ? {
        ...directRating,
        disabled: false,
        reason: undefined,
        items: [
          { kind: 'status' as const, id: 'rating-read-failed', label: t('context.tracksFailed') },
          {
            kind: 'command' as const,
            id: 'rating-retry',
            label: t('menu.retry'),
            keepOpen: true,
            onSelect: selectedTracks.retry,
          },
        ],
      }
    : directRating;
  const { tree, known } = useAtomValueRawSync(page.menu.stateAtom);
  const open = target !== null;
  useEffect(() => {
    if (open) return () => page.menu.close();
  }, [open, page]);
  const lists = useAtomValueRawSync(playlistsAtom).items;
  const [playFailed, setPlayFailed] = useState(false);
  const playAttempt = useRef(0);
  useEffect(
    () => () => {
      playAttempt.current += 1;
    },
    [],
  );
  const ranges = target?.ranges ?? [];
  const count = countRows(ranges);
  const inline = count <= SEND_TO_INLINE_LIMIT;
  const entry = lists.find((item) => item.guid === guid);
  const locked = entry?.isLocked ?? true;
  const anchor = target ? view.trackOf(target.row) : undefined;
  const album = anchor ? albumNavigation.findAlbum(anchor) : null;
  const single = count === 1 ? anchor : undefined;
  const first = view.trackOf(ranges[0]?.start ?? -1);
  const name =
    single?.album ||
    t('trackMenu.batchName', {
      first: first?.title ?? '',
      count,
      rest: Math.max(0, count - 1),
    });
  const valid = () =>
    target !== null &&
    store.get(playlistRows.stateOf(guid)).contentVersion === target.contentVersion &&
    (isCurrent?.() ?? true);
  const run = (node: MenuCommand) => {
    const value = ratingValueOf(known.rating, node);
    void page.menu.run(node).then((ok) => {
      if (ok && value !== null && inline)
        ratings.assume(
          rowsOf(ranges).flatMap((row) => view.trackOf(row) ?? []),
          value,
        );
    });
  };
  const items: TrackMenuItem[] = [
    inline ? 'play' : { action: 'play', disabled: true, reason: t('context.selectionLimited') },
    {
      kind: 'command',
      id: 'play-from-here',
      label: t('context.playFromHere'),
      icon: <Play20Regular />,
      disabled: !target,
      onSelect: () => {
        if (target) void playlistActions.play(guid, target.row);
      },
    },
    'play-next',
    'enqueue',
    divider('send-divider'),
    inline
      ? 'send-to'
      : {
          kind: 'command',
          id: 'send-to',
          label: t('albumDetail.sendTo'),
          disabled: !known.sendToDialog,
          onSelect: () => {
            if (known.sendToDialog) run(known.sendToDialog);
          },
        },
    divider('navigation-divider'),
    'go-to-album',
    divider('rating-divider'),
    'rating',
    'properties',
    'more-commands',
    divider('playlist-divider'),
    {
      kind: 'submenu',
      id: 'filter',
      label: t('playlistPage.filterBy'),
      icon: <Filter20Regular />,
      disabled: !anchor,
      detail: count > 1 ? t('trackMenu.clickedTrack') : undefined,
      items: (anchor ? conditionChoices(anchor) : []).map(({ condition, usable }, index) => ({
        kind: 'command',
        id: `filter:${index}`,
        data: { 'data-filter': condition.field },
        label: t(FILTER_LABELS[condition.field]),
        detail: condition.value,
        disabled: !usable,
        onSelect: () => page.filter.addCondition(guid, condition),
      })),
    },
    {
      kind: 'command',
      id: 'remove',
      label: t('playlistPage.remove'),
      icon: <Delete20Regular />,
      disabled: !count || locked,
      reason: locked ? t('context.locked') : undefined,
      onSelect: () => void page.tracks.remove(guid),
    },
    {
      kind: 'command',
      id: 'crop',
      label: t('playlistPage.crop'),
      icon: <Crop20Regular />,
      disabled: !count || locked || view.shape === 'filtered' || count >= total,
      reason: locked ? t('context.locked') : undefined,
      onSelect: () => void page.tracks.crop(guid),
    },
  ];
  return (
    <>
      {playFailed && (
        <MessageBar intent="error">
          <MessageBarBody>{t('album.commandFailed')}</MessageBarBody>
          <MessageBarActions
            containerAction={
              <Button
                appearance="transparent"
                icon={<Dismiss20Regular />}
                aria-label={t('album.dismiss')}
                onClick={() => setPlayFailed(false)}
              />
            }
          />
        </MessageBar>
      )}
      <TrackContextMenu
        at={target?.at ?? null}
        surfaceAttributes={{ 'data-playlist-track-menu': true }}
        targetKey={JSON.stringify([guid, target?.contentVersion, ranges, target?.row])}
        title={
          single
            ? single.title || single.path
            : t(plural(count, 'album.menuTracksOne', 'album.menuTracks'), { count })
        }
        subtitle={
          single?.artist ??
          [entry?.name, anchor && t('context.clickedTitle', { title: anchor.title || anchor.path })]
            .filter(Boolean)
            .join(' · ')
        }
        isCurrent={valid}
        items={items}
        usable={count > 0}
        multiple={count > 1}
        targets={lists
          .filter((item) => item.guid !== guid)
          .map((item) => ({ guid: item.guid, name: item.name, locked: item.isLocked }))}
        handlers={{
          play: () => {
            const attempt = ++playAttempt.current;
            setPlayFailed(false);
            void playPlaylistSelection(fb.playlist, guid, ranges, valid, (paths) =>
              trackActions.playPaths(paths, 0, LIBRARY_SOURCE),
            ).then((ok) => {
              if (attempt === playAttempt.current) setPlayFailed(!ok);
            });
          },
          next: () => void page.tracks.queueNext(guid, ranges),
          enqueue: () => void page.tracks.queueLast(guid, ranges),
          sendToNew: () => void page.tracks.sendToNew(guid, ranges, name),
          sendTo: (into) => void page.tracks.sendTo(guid, ranges, into.guid),
        }}
        album={{ open: album ? () => albumNavigation.open(album) : null, here: false }}
        rating={inline ? rating : hostRatingEntry(t, known.rating, (node) => run(node))}
        ratingCovers={!inline || !directRating.disabled}
        covered={[{ command: !inline ? known.sendToDialog : null, label: t('albumDetail.sendTo') }]}
        tree={tree}
        runCommand={run}
        retryTree={() => void page.menu.prepare(guid)}
        onClose={() => {
          page.menu.close();
          onClose();
        }}
      />
    </>
  );
}
