import {
  Add20Regular,
  AddSquare20Regular,
  Album20Regular,
  Info20Regular,
  MoreHorizontal20Regular,
  Next20Regular,
  Play20Regular,
  Star20Regular,
  TextBulletListTree20Regular,
  type FluentIcon,
} from '@fluentui/react-icons';
import type { MenuCommand } from 'foo-webview-sdk';
import { createElement, type ReactElement } from 'react';
import type { RatingCommands } from '../host/contextMenu.ts';
import type { Translate } from '../i18n/translate.ts';
import type {
  ContextMenuBranch,
  ContextMenuCommand,
  ContextMenuEntry,
  ContextMenuSeparator,
} from '../kit/context-menu/contextMenuItems.ts';
import type { SendTarget } from './trackListActions.ts';
import type { MenuRating } from './trackMenuRating.ts';

/** 各处曲目菜单共用的标准项。页面按显示顺序写这些 id，中间夹本页自己的条目。 */
export type TrackActionId =
  | 'play'
  | 'play-next'
  | 'enqueue'
  | 'send-to'
  | 'go-to-album'
  | 'rating'
  | 'properties'
  | 'more-commands';

/** 播放、入队、发送怎么执行：作用对象各处不同（一批路径、列表选区、队列句柄），由页面给。 */
export interface TrackMenuHandlers {
  play(): void;
  next(): void;
  enqueue(): void;
  sendToNew(): void;
  sendTo(target: SendTarget): void;
}

/** 「转到专辑」：去的动作（媒体库里找不到这张专辑为 null），以及此刻是否已在它的详情页上（在就不出这一项）。 */
export interface TrackMenuAlbum {
  readonly open: (() => void) | null;
  readonly here: boolean;
}

/** 标准项按它现算。 */
export interface TrackActionContext {
  readonly t: Translate;
  /** 作用对象已到手、可以执行；否则播放、入队与发送置灰。 */
  readonly usable: boolean;
  /** 作用于多首：播放写「播放所选」，「转到专辑」注明去的是右键的那一首。 */
  readonly multiple: boolean;
  readonly targets: readonly SendTarget[];
  readonly handlers: TrackMenuHandlers;
  readonly album: TrackMenuAlbum | null;
  readonly rating: ContextMenuBranch | null;
  /** 宿主树里认出的「属性」；认不出为 null，这一项置灰。 */
  readonly properties: (() => void) | null;
  /** 「更多命令」子菜单的内容，为空就不出这一项。 */
  readonly more: readonly ContextMenuEntry[];
}

/** 一条标准命令：文字、图标、可用与否和执行都按菜单此刻的上下文算。 */
interface TrackCommandAction {
  readonly icon: FluentIcon;
  label(context: TrackActionContext): string;
  enabled(context: TrackActionContext): boolean;
  run(context: TrackActionContext): void;
  /** 为真时整项不出。 */
  hidden?(context: TrackActionContext): boolean;
  /** 置灰时的说明。 */
  reason?(context: TrackActionContext): string | undefined;
  detail?(context: TrackActionContext): string | undefined;
}

type TrackCommandId = 'play' | 'play-next' | 'enqueue' | 'go-to-album' | 'properties';

const COMMANDS: Readonly<Record<TrackCommandId, TrackCommandAction>> = {
  play: {
    icon: Play20Regular,
    label: ({ t, multiple }) => t(multiple ? 'context.playSelected' : 'album.play'),
    enabled: ({ usable }) => usable,
    run: ({ handlers }) => handlers.play(),
  },
  'play-next': {
    icon: Next20Regular,
    label: ({ t }) => t('album.playNext'),
    enabled: ({ usable }) => usable,
    run: ({ handlers }) => handlers.next(),
  },
  enqueue: {
    icon: Add20Regular,
    label: ({ t }) => t('album.enqueue'),
    enabled: ({ usable }) => usable,
    run: ({ handlers }) => handlers.enqueue(),
  },
  'go-to-album': {
    icon: Album20Regular,
    label: ({ t }) => t('trackMenu.goToAlbum'),
    enabled: ({ album }) => !!album?.open,
    run: ({ album }) => album?.open?.(),
    hidden: ({ album }) => !album || album.here,
    reason: ({ t, album }) => (!album?.open ? t('context.albumUnavailable') : undefined),
    detail: ({ t, multiple }) => (multiple ? t('trackMenu.clickedTrack') : undefined),
  },
  properties: {
    icon: Info20Regular,
    label: ({ t }) => t('trackMenu.properties'),
    enabled: ({ properties }) => !!properties,
    run: ({ properties }) => properties?.(),
  },
};

function commandEntry(id: TrackCommandId, context: TrackActionContext): ContextMenuCommand {
  const action = COMMANDS[id];
  return {
    kind: 'command',
    id,
    label: action.label(context),
    icon: createElement(action.icon),
    disabled: !action.enabled(context),
    reason: action.reason?.(context),
    detail: action.detail?.(context),
    onSelect: () => action.run(context),
  };
}

function sendToEntry({ t, usable, targets, handlers }: TrackActionContext): ContextMenuBranch {
  return {
    kind: 'submenu',
    id: 'send-to',
    label: t('album.sendTo'),
    icon: createElement(TextBulletListTree20Regular),
    disabled: !usable,
    items: [
      {
        kind: 'command',
        id: 'send-to-new',
        label: t('album.sendToNew'),
        icon: createElement(AddSquare20Regular),
        onSelect: () => handlers.sendToNew(),
      },
      { kind: 'separator', id: 'targets-divider' },
      ...targets.map((target): ContextMenuCommand => ({
        kind: 'command',
        id: `send:${target.guid}`,
        label: target.name,
        disabled: target.locked,
        detail: target.locked ? t('context.locked') : undefined,
        reason: target.locked ? t('context.locked') : undefined,
        onSelect: () => handlers.sendTo(target),
      })),
    ],
  };
}

function actionEntries(id: TrackActionId, context: TrackActionContext): ContextMenuEntry[] {
  switch (id) {
    case 'send-to':
      return [sendToEntry(context)];
    case 'rating':
      return context.rating ? [context.rating] : [];
    case 'more-commands':
      return context.more.length
        ? [
            {
              kind: 'submenu',
              id: 'more-commands',
              label: context.t('album.moreCommands'),
              icon: createElement(MoreHorizontal20Regular),
              items: context.more,
            },
          ]
        : [];
    default:
      return COMMANDS[id].hidden?.(context) ? [] : [commandEntry(id, context)];
  }
}

/** 改写一条标准命令的文字、图标或可用与否；执行与作用对象不变。 */
export interface TrackActionPatch {
  readonly action: 'play' | 'play-next' | 'enqueue';
  readonly label?: string;
  readonly icon?: ReactElement;
  readonly disabled?: boolean;
  readonly reason?: string;
}

/** 曲目菜单的一项：标准项的 id、改写过的标准命令，或本页自己的条目。 */
export type TrackMenuItem = TrackActionId | TrackActionPatch | ContextMenuEntry;

/** 把页面写的项展开成菜单条目；分隔线由页面写，相邻、首尾的多余分隔线由菜单外壳压掉。 */
export function trackMenuEntries(
  items: readonly TrackMenuItem[],
  context: TrackActionContext,
): ContextMenuEntry[] {
  return items.flatMap((item): ContextMenuEntry[] => {
    if (typeof item === 'string') return actionEntries(item, context);
    if ('action' in item) {
      const { action, ...change } = item;
      return [{ ...commandEntry(action, context), ...change }];
    }
    return [item];
  });
}

export function divider(id: string): ContextMenuSeparator {
  return { kind: 'separator', id };
}

/**
 * 评分子菜单。`current` 为 null 时写「评分未知」，`'mixed'` 写「评分不同」，0 写「未评分」；点一档写入，
 * 点此刻已勾的那一档不重复写。`available` 是能选的几档，`clear` 为假时清除置灰。
 */
export function trackRatingEntries(
  t: Translate,
  current: MenuRating,
  rate: (value: number) => void,
  disabled: boolean,
  available: readonly number[] = [1, 2, 3, 4, 5],
  clear = true,
): ContextMenuBranch {
  return {
    kind: 'submenu',
    id: 'rating',
    label: t('trackMenu.rating'),
    icon: createElement(Star20Regular),
    disabled,
    items: [
      ...(current === null || current === 'mixed'
        ? [
            {
              kind: 'status' as const,
              id: 'rating-state',
              label: t(current === 'mixed' ? 'context.ratingMixed' : 'context.ratingUnknown'),
            },
          ]
        : current === 0
          ? [{ kind: 'status' as const, id: 'rating-state', label: t('context.ratingUnset') }]
          : []),
      ...available.map((value): ContextMenuCommand => ({
        kind: 'command',
        id: `rating:${value}`,
        data: { 'data-rating': value },
        label: t(value === 1 ? 'trackMenu.ratingOne' : 'trackMenu.ratingStars', { count: value }),
        check: 'radio',
        checked: current === value,
        disabled,
        onSelect: () => {
          if (current !== value) rate(value);
        },
      })),
      { kind: 'separator', id: 'rating-divider' },
      {
        kind: 'command',
        id: 'rating:0',
        data: { 'data-rating': 0 },
        label: t('context.clearRating'),
        disabled: disabled || !clear || current === 0,
        onSelect: () => rate(0),
      },
    ],
  };
}

/**
 * 按宿主树里认出的评分子菜单出评分项：勾宿主此刻的那一档，点一档交回树里对应的命令与它的值（清除是 0）。
 * 认不出评分子菜单时整项置灰。
 */
export function hostRatingEntry(
  t: Translate,
  rating: RatingCommands | null,
  rate: (node: MenuCommand, value: number) => void,
): ContextMenuBranch {
  return trackRatingEntries(
    t,
    rating?.current ?? null,
    (value) => {
      const node =
        value === 0 ? rating?.clear : rating?.values.find((entry) => entry.value === value)?.node;
      if (node) rate(node, value);
    },
    !rating,
    rating?.values.map((entry) => entry.value),
    !!rating?.clear,
  );
}
