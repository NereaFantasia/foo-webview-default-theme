import type { MenuCommand } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { knownCommandsOf, type ContextTree } from '../host/contextMenu.ts';
import { contextExtensionEntries, type CoveredCommand } from '../host/contextMenuEntries.ts';
import { translateAtom } from '../i18n/locale.ts';
import { ContextMenu, type ContextMenuProps } from '../kit/context-menu/ContextMenu.tsx';
import type { ContextMenuBranch } from '../kit/context-menu/contextMenuItems.ts';
import { MENU_SURFACE_MOTION } from '../motion/MenuMotion.tsx';
import type { SendTarget } from './trackListActions.ts';
import {
  trackMenuEntries,
  type TrackMenuAlbum,
  type TrackMenuHandlers,
  type TrackMenuItem,
} from './trackMenuEntries.ts';

export interface TrackContextMenuProps extends Pick<
  ContextMenuProps,
  'at' | 'targetKey' | 'title' | 'subtitle' | 'surfaceAttributes' | 'isCurrent'
> {
  /** 菜单的项，按显示顺序：标准项写 id，本页的项直接写条目，分隔线也由页面写。 */
  readonly items: readonly TrackMenuItem[];
  /** 作用对象已到手、可以执行；否则播放、入队与发送置灰。 */
  readonly usable: boolean;
  /** 作用于多首。 */
  readonly multiple?: boolean;
  /** 「发送到」子菜单列出的播放列表。 */
  readonly targets: readonly SendTarget[];
  readonly handlers: TrackMenuHandlers;
  /** 项里有「转到专辑」时必给。 */
  readonly album?: TrackMenuAlbum;
  /** 项里有「评分」时必给。 */
  readonly rating?: ContextMenuBranch;
  /** 「更多命令」里宿主自己的评分各档是否置灰，交给本菜单的评分代办；缺省按评分项可用与否。 */
  readonly ratingCovers?: boolean;
  /** 宿主对作用对象的上下文命令树：「属性」与「更多命令」都出自它。 */
  readonly tree: ContextTree;
  /** 执行树里的一条命令，目标是生成这棵树时的作用对象。 */
  readonly runCommand: (node: MenuCommand) => void;
  /** 作用对象过了建树的条数上限：「更多命令」只写明超了上限。 */
  readonly treeLimited?: boolean;
  /** 读树失败时「更多命令」里的重试；不给就只报失败。 */
  readonly retryTree?: () => void;
  /** 本页自己的项已经代办的宿主命令，在「更多命令」里置灰。 */
  readonly covered?: readonly CoveredCommand[];
  readonly onClose: () => void;
}

/**
 * 曲目右键菜单：标题与副标题由页面按自己的作用对象写；播放、入队、发送、转到专辑、评分、属性与宿主的
 * 「更多命令」按 id 出标准项，本页独有的项夹在其间。
 */
export function TrackContextMenu(props: TrackContextMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { tree, runCommand, rating } = props;
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
  const items = trackMenuEntries(props.items, {
    t,
    usable: props.usable,
    multiple: props.multiple ?? false,
    targets: props.targets,
    handlers: props.handlers,
    album: props.album ?? null,
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
