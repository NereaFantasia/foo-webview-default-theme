import { Copy20Regular } from '@fluentui/react-icons';
import type { MenuCommand } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { useAtomValueRawSync } from 'jotai/react';
import { createElement } from 'react';
import { settle } from '../host/hostCall.ts';
import { batchAbilities } from '../host/trackOrigin.ts';
import { knownCommandsOf, type ContextTree } from '../host/contextMenu.ts';
import { contextExtensionEntries, type CoveredCommand } from '../host/contextMenuEntries.ts';
import { translateAtom } from '../i18n/locale.ts';
import { ContextMenu, type ContextMenuProps } from '../kit/context-menu/ContextMenu.tsx';
import type { ContextMenuBranch } from '../kit/context-menu/contextMenuItems.ts';
import { MENU_SURFACE_MOTION } from '../motion/MenuMotion.tsx';
import type { SendTarget } from './trackListActions.ts';
import type { ObjectRef } from '../nav/objectRef.ts';
import type { LinkableTrack } from './trackLinks.ts';
import {
  trackMenuEntries,
  type TrackMenuHandlers,
  type TrackMenuItem,
} from './trackMenuEntries.ts';
import { useTrackGoTo } from './useTrackGoTo.ts';

export interface TrackContextMenuProps extends Pick<
  ContextMenuProps,
  'at' | 'targetKey' | 'title' | 'subtitle' | 'surfaceAttributes' | 'isCurrent'
> {
  /** 菜单的项，按显示顺序：标准项写 id，本页的项直接写条目，分隔线也由页面写 */
  readonly items: readonly TrackMenuItem[];
  /** 作用对象已到手、可以执行；否则播放、入队与发送置灰 */
  readonly usable: boolean;
  /** 作用于多首 */
  readonly multiple?: boolean;
  /** 「发送到」子菜单列出的播放列表 */
  readonly targets: readonly SendTarget[];
  readonly handlers: TrackMenuHandlers;
  /** 「转到专辑」「转到艺人」去的是这一首：右键点的那一首，多选时也是它 */
  readonly anchor?: LinkableTrack | null;
  /** 跳转前所在表面要做的事，如离开迷你模式 */
  readonly beforeGoTo?: (ref: ObjectRef) => void;
  /** 项里有「评分」时必给 */
  readonly rating?: ContextMenuBranch;
  /** 「更多命令」里宿主自己的评分各档是否置灰，交给本菜单的评分代办；缺省按评分项可用与否 */
  readonly ratingCovers?: boolean;
  /** 宿主对作用对象的上下文命令树：「属性」与「更多命令」都出自它 */
  readonly tree: ContextTree;
  /** 执行树里的一条命令，目标是生成这棵树时的作用对象 */
  readonly runCommand: (node: MenuCommand) => void;
  /** 作用对象过了建树的条数上限：「更多命令」只写明超了上限 */
  readonly treeLimited?: boolean;
  /** 读树失败时「更多命令」里的重试；不给就只报失败 */
  readonly retryTree?: () => void;
  /** 本页自己的项已经代办的宿主命令，在「更多命令」里置灰 */
  readonly covered?: readonly CoveredCommand[];
  /**
   * 作用对象的路径与显示标题，同序。给了就按来源收窄：一批里有不进媒体库的曲目（在线曲目）时，不出发送；
   * 不交给宿主命令时不出评分，并补一项「复制标题」。媒体库的菜单不必给，库里没有在线曲目。「转到」照出：
   * 在线曲目去的是在线的专辑与艺人
   */
  readonly objects?: { readonly paths: readonly string[]; readonly titles: readonly string[] };
  readonly onClose: () => void;
}

/** 按来源收窄时去掉的项，按项的 id 认：标准项与页面自写的同名项一样处理 */
const LIBRARY_ACTIONS = new Set(['send-to']);
const HOST_RECORDS = new Set(['rating']);

function itemId(item: TrackMenuItem): string | null {
  if (typeof item === 'string') return item;
  return 'id' in item ? item.id : null;
}

/**
 * 曲目右键菜单：标题与副标题由页面按自己的作用对象写；播放、入队、发送、转到、评分、属性与宿主的
 * 「更多命令」按 id 出标准项，本页独有的项夹在其间
 */
export function TrackContextMenu(props: TrackContextMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { tree, runCommand, rating } = props;
  const goTo = useTrackGoTo(props.anchor ?? null, props.beforeGoTo);
  const known = knownCommandsOf(tree);
  const properties = known.properties;
  const covers = props.ratingCovers ?? (!!rating && !rating.disabled);
  const more = contextExtensionEntries(t, tree, runCommand, props.treeLimited, props.retryTree, [
    { command: properties, label: t('trackMenu.properties') },
    ...(covers
      ? [
          ...(known.rating?.values.map(({ node }) => ({
            command: node,
            label: t('trackMenu.rating'),
          })) ?? []),
          { command: known.rating?.clear ?? null, label: t('trackMenu.ratingClear') },
        ]
      : []),
    ...(props.covered ?? []),
  ]);
  const abilities = props.objects ? batchAbilities(props.objects.paths) : null;
  const titles = props.objects?.titles ?? [];
  const shown = abilities
    ? props.items.filter((item) => {
        const id = itemId(item);
        if (id === null) return true;
        if (!abilities.libraryActions && LIBRARY_ACTIONS.has(id)) return false;
        return abilities.hostCommands || !HOST_RECORDS.has(id);
      })
    : props.items;
  const copy: TrackMenuItem[] =
    abilities && !abilities.hostCommands && titles.length
      ? [
          { kind: 'separator', id: 'copy-divider' },
          {
            kind: 'command',
            id: 'copy-title',
            label: t('online.copyTitle'),
            icon: createElement(Copy20Regular),
            onSelect: () => void settle(() => fb.clipboard.write(titles.join('\n'))),
          },
        ]
      : [];
  const items = trackMenuEntries([...shown, ...copy], {
    t,
    usable: props.usable,
    multiple: props.multiple ?? false,
    targets: props.targets,
    handlers: props.handlers,
    goTo,
    rating: rating ?? null,
    properties: properties ? () => runCommand(properties) : null,
    more,
  });
  return (
    <ContextMenu
      at={props.at}
      targetKey={props.targetKey}
      title={props.title}
      subtitle={props.subtitle}
      surfaceAttributes={props.surfaceAttributes}
      isCurrent={props.isCurrent}
      items={items}
      backLabel={t('context.back')}
      surfaceMotion={MENU_SURFACE_MOTION}
      onClose={props.onClose}
    />
  );
}
