import { BookOpen20Regular, Copy20Regular } from '@fluentui/react-icons';
import { fb } from 'foo-webview-sdk/bridge';
import { useAtomValueRawSync } from 'jotai/react';
import { settle } from '../../../host/hostCall.ts';
import type { MessageKey } from '../../../i18n/en.ts';
import { translateAtom } from '../../../i18n/locale.ts';
import { ContextMenu } from '../../../kit/context-menu/ContextMenu.tsx';
import { useService } from '../../../kit/useService.ts';
import { MENU_SURFACE_MOTION } from '../../../motion/MenuMotion.tsx';
import { objectOpenerKey } from '../../../nav/objectOpener.ts';
import { onlineListSubject, type OnlineListSubject } from '../../../nav/places.ts';
import type {
  MusicAlbum,
  MusicArtist,
  MusicPlaylist,
  MusicTrack,
} from '../../../server/musicObjects.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { divider, trackMenuEntries } from '../../../track/trackMenuEntries.ts';
import { artistNames } from './OnlineItems.tsx';
import { useOnlineObjectActions } from './useOnlineObjectActions.ts';

/** 菜单头第二行的种类名 */
export const ONLINE_LIST_KIND_LABELS = {
  album: 'onlineList.kind.album',
  playlist: 'onlineList.kind.playlist',
  artist: 'onlineList.kind.artist',
} as const satisfies Record<OnlineListSubject['kind'], MessageKey>;

export interface OnlineObjectTarget {
  readonly list: OnlineListSubject;
  /** 菜单头第二行种类之后的字，如专辑的艺人 */
  readonly detail?: string;
  /** 已取到的曲目；不给时播放、入队前从在线列表的数据里取第一页 */
  readonly tracks?: readonly MusicTrack[];
}

/** 搜索结果里的一张专辑、一位艺人或一张歌单作为菜单的作用对象 */
export function objectTargetOf(item: MusicAlbum | MusicArtist | MusicPlaylist): OnlineObjectTarget {
  if ('releaseDate' in item)
    return { list: { kind: 'album', ref: item.ref, title: item.title }, detail: artistNames(item) };
  if ('cover' in item) return { list: { kind: 'playlist', ref: item.ref, title: item.title } };
  return { list: { kind: 'artist', ref: item.ref, title: item.name } };
}

export interface OnlineObjectMenuProps {
  readonly menu: { readonly at: TablePoint; readonly target: OnlineObjectTarget } | null;
  /** 已在这张列表的页面上：不出「打开」 */
  readonly here?: boolean;
  onClose(): void;
  /** 起播或入队没成，由页面写提示 */
  onFailed(message: MessageKey): void;
}

/**
 * 在线专辑、歌单与艺人的对象菜单：搜索结果里右键图块与列表页头的 ⋯ 共用。播放与入队作用于整张列表，
 * 歌单只带已取到的那些曲目。在线曲目不进 fb2k 的播放列表，宿主也不给它们建命令树，所以没有发送到、
 * 属性与更多命令
 */
export function OnlineObjectMenu({ menu, here = false, onClose, onFailed }: OnlineObjectMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const actions = useOnlineObjectActions(onFailed);
  const objects = useService(objectOpenerKey);
  const target = menu?.target;
  const list = target?.list;
  const noop = () => {};
  const run = (queue: boolean | null) => async () => {
    if (target) await actions.run(target, queue);
  };
  const items = trackMenuEntries(
    [
      ...(here
        ? []
        : [
            {
              kind: 'command' as const,
              id: 'open-list',
              label: t('onlineList.open'),
              icon: <BookOpen20Regular />,
              onSelect: () => {
                if (list) void objects.open({ kind: 'onlineList', list });
              },
            },
            divider('open-divider'),
          ]),
      'play',
      'play-next',
      'enqueue',
      divider('copy-divider'),
      {
        kind: 'command',
        id: 'copy-name',
        label: t('onlineList.copyName'),
        icon: <Copy20Regular />,
        onSelect: () => {
          if (list) void settle(() => fb.clipboard.write(list.title));
        },
      },
    ],
    {
      t,
      usable: !!list,
      multiple: false,
      targets: [],
      handlers: {
        play: () => void run(null)(),
        next: () => void run(true)(),
        enqueue: () => void run(false)(),
        sendTo: noop,
        sendToNew: noop,
      },
      goTo: null,
      rating: null,
      properties: null,
      more: [],
    },
  );
  const kind = list ? t(ONLINE_LIST_KIND_LABELS[list.kind]) : '';
  return (
    <ContextMenu
      at={menu?.at ?? null}
      targetKey={list ? onlineListSubject(list) : ''}
      title={list?.title ?? ''}
      subtitle={target?.detail ? t('onlineList.kindDetail', { kind, detail: target.detail }) : kind}
      surfaceAttributes={{ 'data-online-object-menu': true }}
      items={items}
      backLabel={t('context.back')}
      surfaceMotion={MENU_SURFACE_MOTION}
      onClose={onClose}
    />
  );
}
