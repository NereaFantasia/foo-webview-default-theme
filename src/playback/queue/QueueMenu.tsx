import {
  AddSquare20Regular,
  ArrowUp20Regular,
  Crop20Regular,
  Delete20Regular,
  Play20Regular,
  TextBulletListTree20Regular,
} from '@fluentui/react-icons';
import type { MenuCommand } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import type { ContextMenuEntry } from '../../kit/context-menu/contextMenuItems.ts';
import { knownCommandsOf } from '../../host/contextMenu.ts';
import { TrackContextMenu } from '../../track/TrackContextMenu.tsx';
import {
  divider,
  hostRatingEntry,
  type TrackMenuHandlers,
  type TrackMenuItem,
} from '../../track/trackMenuEntries.ts';
import { useService } from '../../kit/useService.ts';
import { queueKey } from './queueServices.ts';
import { displayOf } from '../../track/displayTrack.ts';
import { onlineTracksAtom } from '../onlineTracks.ts';
import { MENU_PATHS_LIMIT, queueMenuAtom } from './queueMenu.ts';
import { queueViewAtom } from './queueState.ts';
import { upNextAtom } from './upNext.ts';
import type { RowPoint } from './QueueRow.tsx';
import type { QueueListRow } from './useQueueList.ts';
import { ratingsKey } from '../../track/trackRatings.ts';

interface CurrentMenuRow extends Omit<QueueListRow, 'kind'> {
  readonly kind: 'current';
}

export interface QueueMenuTarget {
  readonly at: RowPoint;
  /** 作用于哪几行，同在一段、按列表顺序；第一行是右键落在的那一行 */
  readonly rows: readonly (QueueListRow | CurrentMenuRow)[];
  readonly anchor: QueueListRow | CurrentMenuRow;
  readonly play?: () => void;
}

export interface QueueMenuProps {
  readonly target: QueueMenuTarget | null;
  /** 这几行还在列表里：队列在别处变了、行没了，菜单关掉 */
  isCurrent(): boolean;
  /** 菜单里的命令都经这里跑：失败时队列页出提示 */
  perform(command: () => Promise<boolean>): void;
  /** 「立即播放」之前调：换过去之后队列页把当前卡置顶 */
  onPlay?(): void;
  onClose(): void;
}

/**
 * 队列行的两份菜单，分组与各处的曲目菜单同一套。「队列」段：立即播放、移到队首，发送到，转到专辑、转到艺术家，
 * 评分、属性、更多命令，从队列移除、移除其他队列项；已在队列里的不出「加入队列」，移除与只留这一首都只改队列，
 * 不碰播放列表。「接下来」段：立即播放、下一首播放、加入队列，其余同上，没有移除：它们还不在队列里
 */
export function QueueMenu({ target, isCurrent, perform, onPlay, onClose }: QueueMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const menu = useAtomValueRawSync(queueMenuAtom);
  const head = useAtomValueRawSync(queueViewAtom).entries[0]?.key ?? null;
  const source = useAtomValueRawSync(upNextAtom).list;
  const ratings = useService(ratingsKey);
  const online = useAtomValueRawSync(onlineTracksAtom);
  const services = useService(queueKey);
  if (!target) return null;
  const { rows, anchor } = target;
  const queued = anchor.kind === 'queued';
  const single = rows.length === 1;
  // 菜单头、发送到新列表的名字与复制的标题都照行上写的：在线曲目套上展示信息
  const shown = rows.map((row) => displayOf(row.track, online, t));
  const anchorShown = displayOf(anchor.track, online, t);
  const tracks = shown.map((item) => item.track);
  const handles = tracks.map((track) => track.handle);
  const known = knownCommandsOf(menu.tree);
  const run = (node: MenuCommand) => perform(() => services.menu.run(node));
  // 新列表的名字同媒体库的曲目菜单：一首写标题，同一张专辑写专辑名，否则写「某某 等 N 首」
  const albums = new Set(tracks.map((track) => track.album));
  const batchName = single
    ? anchorShown.title
    : albums.size === 1 && tracks[0]?.album
      ? tracks[0].album
      : t('trackMenu.batchName', {
          first: shown[0]?.title ?? '',
          count: rows.length,
          rest: Math.max(0, rows.length - 1),
        });

  const handlers: TrackMenuHandlers = {
    play: () => {
      onPlay?.();
      if (queued) {
        perform(() => services.actions.playNow(anchor.key));
        return;
      }
      if (target.play) {
        target.play();
        return;
      }
      const row = anchor.row;
      if (source && row !== null) {
        perform(() => services.commands.playFrom(source.guid, row, anchor.track.handle));
      }
    },
    next: () => perform(() => services.commands.enqueue(handles, 'next')),
    enqueue: () => perform(() => services.commands.enqueue(handles, 'last')),
    sendToNew: () => perform(() => services.menu.sendToNew(batchName)),
    sendTo: (entry) => perform(() => services.menu.sendTo(entry.guid)),
  };
  const playNow: ContextMenuEntry = {
    kind: 'command',
    id: 'play-now',
    label: t('queue.menu.playNow'),
    icon: <Play20Regular />,
    disabled: !queued && !target.play && (!source || anchor.row === null),
    onSelect: handlers.play,
  };
  const playing: TrackMenuItem[] = queued
    ? [
        playNow,
        {
          kind: 'command',
          id: 'move-to-top',
          label: t('queue.menu.moveToTop'),
          icon: <ArrowUp20Regular />,
          disabled: anchor.number === 1 && single,
          onSelect: () =>
            perform(() =>
              single
                ? services.actions.moveToTop(anchor.key)
                : services.actions.move(
                    rows.map((row) => row.key),
                    head,
                  ),
            ),
        },
      ]
    : [playNow, 'play-next', 'enqueue'];

  // 与标准的「发送到」不同：锁着的目标只在右侧注明，悬停说明仍是列表名
  const sending: ContextMenuEntry = {
    kind: 'submenu',
    id: 'send-to',
    label: t('album.sendTo'),
    icon: <TextBulletListTree20Regular />,
    items: [
      {
        kind: 'command',
        id: 'send-to-new',
        label: t('album.sendToNew'),
        icon: <AddSquare20Regular />,
        onSelect: handlers.sendToNew,
      },
      { kind: 'separator', id: 'targets-divider' },
      ...menu.targets.map((entry): ContextMenuEntry => ({
        kind: 'command',
        id: `send:${entry.guid}`,
        label: entry.name,
        disabled: entry.locked,
        detail: entry.locked ? t('context.locked') : undefined,
        onSelect: () => handlers.sendTo(entry),
      })),
    ],
  };

  const rating = hostRatingEntry(t, known.rating, (command, value) =>
    perform(async () => {
      const done = await services.menu.run(command);
      if (done) ratings.assume(tracks, value);
      return done;
    }),
  );

  const removing: ContextMenuEntry[] = queued
    ? [
        divider('remove-divider'),
        {
          kind: 'command',
          id: 'remove',
          label: t('queue.menu.remove'),
          icon: <Delete20Regular />,
          detail: 'Delete',
          onSelect: () => perform(() => services.actions.remove(rows.map((row) => row.key))),
        },
        {
          kind: 'command',
          id: 'keep-only',
          label: t('queue.menu.keepOnly'),
          icon: <Crop20Regular />,
          disabled: !single,
          onSelect: () => perform(() => services.actions.keepOnly(anchor.key)),
        },
      ]
    : [];

  const items: TrackMenuItem[] = [
    ...playing,
    divider('send-divider'),
    sending,
    divider('go-divider'),
    'go-to-album',
    'go-to-artist',
    divider('host-divider'),
    'rating',
    'properties',
    'more-commands',
    ...removing,
  ];
  const artist = anchorShown.track.artist;
  const subtitle = queued
    ? t('queue.menu.queuedAt', { index: anchor.number, artist })
    : anchor.kind === 'review' || anchor.kind === 'current'
      ? `${t(anchor.kind === 'current' ? 'rightCard.following' : 'queue.review.title')} · ${artist}`
      : anchor.kind === 'earlier'
        ? t('queue.menu.earlierAt', { artist })
        : t('queue.menu.upNextAt', { artist });
  return (
    <TrackContextMenu
      at={target.at}
      isCurrent={isCurrent}
      objects={{
        paths: tracks.map((track) => track.path),
        titles: shown.map((item) => item.title),
      }}
      surfaceAttributes={{ 'data-queue-menu': anchor.kind }}
      targetKey={JSON.stringify(rows.map((row) => row.key))}
      title={
        single
          ? anchorShown.title
          : t(plural(rows.length, 'queue.menu.selectedOne', 'queue.menu.selected'), {
              count: rows.length,
            })
      }
      subtitle={single ? subtitle : undefined}
      items={items}
      usable
      targets={menu.targets}
      handlers={handlers}
      anchor={anchor.track}
      rating={rating}
      ratingCovers
      tree={menu.tree}
      runCommand={run}
      treeLimited={menu.limited && rows.length > MENU_PATHS_LIMIT}
      retryTree={() => void services.menu.retry()}
      onClose={onClose}
    />
  );
}
