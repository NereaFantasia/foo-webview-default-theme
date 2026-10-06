import { ArrowCounterclockwise20Regular, Stop20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import type { ContextMenuPoint } from '../../../kit/context-menu/contextMenuGeometry.ts';
import { historyAtom } from '../../../nav/navHistory.ts';
import { ratingsVersionAtom, ratingsKey } from '../../../track/trackRatings.ts';
import { TrackContextMenu } from '../../../track/TrackContextMenu.tsx';
import {
  divider,
  trackRatingEntries,
  type TrackMenuItem,
} from '../../../track/trackMenuEntries.ts';
import { displayTitle } from '../now-playing/nowPlaying.ts';
import { trackKeyOf, playbackKey } from '../../../playback/playbackContract.ts';
import { playbackCanSeekAtom, playbackConnectedAtom } from '../../../playback/playerAtoms.ts';
import { PLAYER_SURFACE_ATTR } from '../playerFocus.ts';
import { nowPlayingMenuAtom, nowPlayingMenuKey } from './nowPlayingMenu.ts';
import { useService } from '../../../kit/useService.ts';
import { trackActionsKey } from '../../../track/trackActions.ts';
import { albumNavigationKey } from '../../../track/albumNavigation.ts';

export interface NowPlayingMenuProps {
  readonly at: ContextMenuPoint | null;
  readonly onClose: () => void;
}

export function NowPlayingMenu({ at, onClose }: NowPlayingMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const state = useAtomValueRawSync(nowPlayingMenuAtom);
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const canSeek = useAtomValueRawSync(playbackCanSeekAtom);
  useAtomValueRawSync(ratingsVersionAtom);
  useAtomValueRawSync(historyAtom);
  const menu = useService(nowPlayingMenuKey);
  const playback = useService(playbackKey);
  const ratings = useService(ratingsKey);
  const trackActions = useService(trackActionsKey);
  const albumNavigation = useService(albumNavigationKey);
  const { track, stamp, tree, path, targets, album, stopAfter } = state;
  useEffect(() => (track ? ratings.watch([track], stamp) : undefined), [track, stamp, ratings]);
  if (!track) return null;
  const report = (action: Promise<boolean>) => void menu.report(action);
  const items: TrackMenuItem[] = [
    'rating',
    {
      kind: 'command',
      id: 'stop',
      label: t('context.stop'),
      icon: <Stop20Regular />,
      onSelect: () => void playback.stop(),
    },
    {
      kind: 'command',
      id: 'stop-after',
      label: t('context.stopAfter'),
      check: 'checkbox',
      checked: stopAfter === true,
      disabled: stopAfter === null,
      onSelect: () => void menu.setStopAfter(stopAfter !== true),
    },
    divider('play-divider'),
    {
      action: 'play',
      label: t('context.restart'),
      icon: <ArrowCounterclockwise20Regular />,
      disabled: !canSeek,
    },
    'play-next',
    'enqueue',
    divider('send-divider'),
    'send-to',
    divider('navigation-divider'),
    'go-to-album',
    divider('properties-divider'),
    'properties',
    'more-commands',
  ];
  return (
    <TrackContextMenu
      at={at}
      targetKey={trackKeyOf(track)}
      isCurrent={() => menu.isCurrent(track)}
      title={displayTitle(track)}
      subtitle={[t('player.nowPlaying'), track.artist].filter(Boolean).join(' · ')}
      surfaceAttributes={{ 'data-now-playing-menu': true, [PLAYER_SURFACE_ATTR]: 'more' }}
      items={items}
      usable={connected}
      targets={targets}
      handlers={{
        play: () => void menu.restart(),
        next: () => report(trackActions.queuePaths([path], true)),
        enqueue: () => report(trackActions.queuePaths([path], false)),
        sendToNew: () => report(trackActions.sendPathsToNew([path], displayTitle(track))),
        sendTo: (target) => report(trackActions.sendPathsTo([path], target)),
      }}
      album={{
        open: album ? () => albumNavigation.open(album) : null,
        here: !!album && albumNavigation.isCurrent(album),
      }}
      rating={trackRatingEntries(
        t,
        ratings.ratingOf(track, stamp),
        (value) => void ratings.setRating(track, value),
        !ratings.canRate(track),
      )}
      tree={tree}
      runCommand={(node) => void menu.run(node)}
      retryTree={() => void menu.retry()}
      onClose={onClose}
    />
  );
}
