import { Copy20Regular } from '@fluentui/react-icons';
import { fb } from 'foo-webview-sdk/bridge';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo } from 'react';
import { settle } from '../../../host/hostCall.ts';
import { translateAtom } from '../../../i18n/locale.ts';
import { pluralAtom } from '../../../i18n/plural.ts';
import { ContextMenu } from '../../../kit/context-menu/ContextMenu.tsx';
import { useService } from '../../../kit/useService.ts';
import { MENU_SURFACE_MOTION } from '../../../motion/MenuMotion.tsx';
import type { MusicTrack } from '../../../server/musicObjects.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { musicTrackLinks } from '../../../track/trackLinks.ts';
import { divider, trackMenuEntries } from '../../../track/trackMenuEntries.ts';
import { useLinkedGoTo } from '../../../track/useTrackGoTo.ts';
import { artistNames } from './OnlineItems.tsx';
import { onlinePlayKey } from './onlinePlay.ts';

export interface OnlineTrackMenuProps {
  readonly menu: { readonly at: TablePoint; readonly tracks: readonly MusicTrack[] } | null;
  onClose(): void;
  /** 「播放」由页面定：只有一首时从它起播整页已加载的结果，多首时只播所选 */
  onPlay(tracks: readonly MusicTrack[]): void;
  /** 下一首播放与加入队列的结果，由页面写提示 */
  onQueued(ok: boolean): void;
}

/**
 * 在线曲目的右键菜单：沿用曲目菜单的播放、下一首播放、加入队列与「转到专辑 / 转到艺人」（去在线的专辑页与艺人页），
 * 另加复制标题。在线曲目不在媒体库里，没有宿主的命令树，也不出发送与评分
 */
export function OnlineTrackMenu({ menu, onClose, onPlay, onQueued }: OnlineTrackMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const player = useService(onlinePlayKey);
  const picked = menu?.tracks ?? [];
  const single = picked.length === 1 ? picked[0] : undefined;
  // 多首时不出「转到」：菜单不知道点的是哪一首
  const goTo = useLinkedGoTo(
    useMemo(() => (single ? musicTrackLinks(single) : null), [single]),
    undefined,
    'trackMenu.noAlbumPage',
  );
  const noop = () => {};
  const items = trackMenuEntries(
    [
      'play',
      'play-next',
      'enqueue',
      divider('go-to-divider'),
      'go-to-album',
      'go-to-artist',
      divider('copy-divider'),
      {
        kind: 'command',
        id: 'copy-title',
        label: t('online.copyTitle'),
        icon: <Copy20Regular />,
        onSelect: () =>
          void settle(() => fb.clipboard.write(picked.map((track) => track.title).join('\n'))),
      },
    ],
    {
      t,
      usable: picked.length > 0,
      multiple: picked.length > 1,
      targets: [],
      handlers: {
        play: () => onPlay(picked),
        next: () => void player.queue(picked, true).then(onQueued),
        enqueue: () => void player.queue(picked, false).then(onQueued),
        sendTo: noop,
        sendToNew: noop,
      },
      goTo,
      rating: null,
      properties: null,
      more: [],
    },
  );
  return (
    <ContextMenu
      at={menu?.at ?? null}
      targetKey={JSON.stringify(picked.map((track) => track.ref.id))}
      title={
        single
          ? single.title
          : t(plural(picked.length, 'album.menuTracksOne', 'album.menuTracks'), {
              count: picked.length,
            })
      }
      subtitle={single ? artistNames(single) : undefined}
      surfaceAttributes={{ 'data-online-menu': true }}
      items={items}
      backLabel={t('context.back')}
      surfaceMotion={MENU_SURFACE_MOTION}
      onClose={onClose}
    />
  );
}
