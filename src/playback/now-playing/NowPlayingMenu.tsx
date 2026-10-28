import { ArrowCounterclockwise20Regular, Stop20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type { ContextMenuPoint } from '../../kit/context-menu/contextMenuGeometry.ts';
import { ratingsVersionAtom, ratingsKey } from '../../track/trackRatings.ts';
import { TrackContextMenu } from '../../track/TrackContextMenu.tsx';
import { divider, trackRatingEntries, type TrackMenuItem } from '../../track/trackMenuEntries.ts';
import { displayTitle } from './nowPlaying.ts';
import { qualityBranch, useQualityMenu } from './qualityMenu.ts';
import { trackKeyOf, playbackKey } from '../playbackContract.ts';
import { playbackCanSeekAtom, playbackConnectedAtom } from '../playerAtoms.ts';
import { nowPlayingMenuAtom, nowPlayingMenuKey } from './nowPlayingMenu.ts';
import { useService } from '../../kit/useService.ts';
import { trackActionsKey } from '../../track/trackActions.ts';

export interface NowPlayingMenuProps {
  readonly at: ContextMenuPoint | null;
  /** 带在浮层根上的属性，界面据此认出焦点在哪个键弹出的浮层里 */
  readonly surfaceAttributes?: Readonly<Record<string, string>>;
  /** 放菜单的界面排在最前面的项（带分隔线）；缺省没有，播放栏与右侧卡不传 */
  readonly extraItems?: readonly TrackMenuItem[];
  readonly onClose: () => void;
}

export function NowPlayingMenu({
  at,
  surfaceAttributes,
  extraItems = [],
  onClose,
}: NowPlayingMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const state = useAtomValueRawSync(nowPlayingMenuAtom);
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const canSeek = useAtomValueRawSync(playbackCanSeekAtom);
  useAtomValueRawSync(ratingsVersionAtom);
  const menu = useService(nowPlayingMenuKey);
  const playback = useService(playbackKey);
  const ratings = useService(ratingsKey);
  const trackActions = useService(trackActionsKey);
  const { track, stamp, tree, path, targets, stopAfter } = state;
  const quality = useQualityMenu(track);
  useEffect(() => (track ? ratings.watch([track], stamp) : undefined), [track, stamp, ratings]);
  if (!track) return null;
  const report = (action: Promise<boolean>) => void menu.report(action);
  const items: TrackMenuItem[] = [
    ...extraItems,
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
    ...(quality ? [divider('quality-divider'), qualityBranch(quality, t)] : []),
    divider('send-divider'),
    'send-to',
    divider('navigation-divider'),
    'go-to-album',
    'go-to-artist',
    divider('properties-divider'),
    'properties',
    'more-commands',
  ];
  return (
    <TrackContextMenu
      at={at}
      targetKey={trackKeyOf(track)}
      isCurrent={() => menu.isCurrent(track)}
      objects={{ paths: [track.path], titles: [displayTitle(track)] }}
      title={displayTitle(track)}
      subtitle={[t('player.nowPlaying'), track.artist].filter(Boolean).join(' · ')}
      surfaceAttributes={{ 'data-now-playing-menu': true, ...surfaceAttributes }}
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
      anchor={track}

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
