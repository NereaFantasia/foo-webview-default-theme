import { VideoClip20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import { isVideoPath } from '../../../track/mediaKind.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { TrackContextMenu } from '../../../track/TrackContextMenu.tsx';
import { divider, type TrackMenuItem } from '../../../track/trackMenuEntries.ts';
import { trackDisplayTitle } from '../../../track/trackDisplayTitle.ts';
import { useTrackMenuRating } from '../../../track/useTrackMenuRating.ts';
import type { FoldersTarget } from './foldersActions.ts';
import { useFoldersMenu } from './useFoldersMenu.ts';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';
import { foldersPrefsAtom } from '../foldersPrefs.ts';
import { foldersTreeAtom } from '../tree/foldersTree.ts';
import { ratingsKey } from '../../../track/trackRatings.ts';

export interface FoldersMenuProps {
  readonly target: FoldersTarget;
  readonly point: TablePoint;
  onClose(): void;
  isCurrent?(): boolean;
}

export function FoldersMenu({ target, point, onClose, isCurrent }: FoldersMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const ratings = useService(ratingsKey);
  const { pins } = useAtomValueRawSync(foldersPrefsAtom);
  const catalog = useAtomValueRawSync(foldersTreeAtom);
  const menu = useFoldersMenu(target);
  const rating = useTrackMenuRating(t, ratings, menu.tracks ?? [], menu.ratingStamp, true);
  const single = target.trackMenu && target.tracks?.length === 1 ? target.tracks[0] : undefined;
  const anchor = target.anchor ?? single;
  const ready = { nodes: target.nodes, tracks: menu.tracks ?? undefined };
  const node = target.nodes.length === 1 ? target.nodes[0] : undefined;
  const queueLimited = (menu.tracks?.length ?? 0) > 256;
  const limitedReason = t('context.selectionLimited');
  const items: TrackMenuItem[] = [
    // 只有右键单个视频文件时出；执行与「播放」同一条路，起播成功后才进视频页
    ...(single && isVideoPath(single.path)
      ? [
          {
            kind: 'command' as const,
            id: 'play-watch',
            label: t('folders.playWatch'),
            icon: <VideoClip20Regular />,
            disabled: menu.loading || !menu.tracks?.length,
            onSelect: () => void folders.playAndWatch(ready),
          },
        ]
      : []),
    'play',
    queueLimited ? { action: 'play-next', disabled: true, reason: limitedReason } : 'play-next',
    queueLimited ? { action: 'enqueue', disabled: true, reason: limitedReason } : 'enqueue',
    divider('send-divider'),
    'send-to',
    ...(target.trackMenu
      ? [divider('navigation-divider'), 'go-to-album' as const, 'go-to-artist' as const]
      : []),
    divider('properties-divider'),
    'rating',
    'properties',
    'more-commands',
  ];
  if (!target.tracks || target.nodeMenu) {
    items.push(
      divider('directory-divider'),
      {
        kind: 'command',
        id: 'autoplaylist',
        label: t('folders.autoplaylist'),
        disabled: menu.loading || !menu.tracks?.length,
        onSelect: () => void folders.actions.autoplaylist(target),
      },
      {
        kind: 'command',
        id: 'expand',
        label: t('folders.expand'),
        onSelect: () => {
          for (const item of target.nodes) void folders.tree.expand(item.key, true);
        },
      },
      {
        kind: 'command',
        id: 'collapse',
        label: t('folders.collapse'),
        onSelect: () => {
          for (const item of target.nodes) void folders.tree.expand(item.key, false);
        },
      },
      {
        kind: 'command',
        id: 'expand-recursive',
        label: t('folders.expandRecursive'),
        onSelect: () =>
          void folders.tree.expandRecursive(
            target.nodes.map((item) => item.key),
            true,
          ),
      },
      {
        kind: 'command',
        id: 'collapse-recursive',
        label: t('folders.collapseRecursive'),
        onSelect: () =>
          void folders.tree.expandRecursive(
            target.nodes.map((item) => item.key),
            false,
          ),
      },
    );
    if (node && menu.realDirectory)
      items.push({
        kind: 'command',
        id: 'explore',
        label: t('folders.explore'),
        onSelect: () => void folders.actions.explore(node),
      });
  }
  if (target.trackMenu && target.tracks?.length) {
    const tracks = target.tracks;
    items.push(divider('trash-divider'), {
      kind: 'command',
      id: 'trash',
      label: t('folders.trash'),
      onSelect: () => folders.trash.prepare(tracks),
    });
  }
  if (target.header) {
    items.push(divider('header-divider'));
    if (node) {
      const pinned = pins.some((pin) => pin.key === node.key);
      items.push({
        kind: 'command',
        id: 'pin',
        label: t(pinned ? 'folders.unpin' : 'folders.pin'),
        onSelect: () => folders.prefs.pin(node),
      });
    }
    items.push({
      kind: 'command',
      id: 'refresh',
      label: t('folders.refresh'),
      disabled: catalog.status === 'loading',
      onSelect: () => void folders.tree.retry(),
    });
  }
  return (
    <TrackContextMenu
      at={point}
      isCurrent={isCurrent}
      targetKey={JSON.stringify([
        target.nodes.map((item) => item.key),
        target.tracks?.map((item) => item.handle),
        target.nodeMenu,
      ])}
      title={
        single
          ? trackDisplayTitle(single)
          : target.tracks && !target.nodeMenu
            ? t('folders.trackCount', { count: target.tracks.length })
            : (node?.name ?? t('folders.selected', { count: target.nodes.length }))
      }
      subtitle={
        menu.loading
          ? t('folders.loading')
          : single
            ? [single.artist, single.album].filter(Boolean).join(' · ')
            : anchor
              ? t('context.clickedTitle', { title: trackDisplayTitle(anchor) })
              : undefined
      }
      items={items}
      usable={!menu.loading && !!menu.tracks?.length}
      multiple={!!target.tracks && target.tracks.length > 1 && !target.nodeMenu}
      targets={menu.targets}
      handlers={{
        play: () => void folders.actions.run(ready, 'play'),
        next: () => void folders.actions.run(ready, 'next'),
        enqueue: () => void folders.actions.run(ready, 'queue'),
        sendToNew: () => void folders.actions.run(ready, 'new'),
        sendTo: ({ guid }) => void folders.actions.run(ready, { guid }),
      }}
      anchor={anchor ?? null}

      rating={rating}
      tree={menu.tree}
      runCommand={(command) => void folders.actions.native(menu.tree, command)}
      treeLimited={(menu.tracks?.length ?? 0) > 500}
      retryTree={menu.retry}
      onClose={onClose}
    />
  );
}
