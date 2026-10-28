import { PanelRightContract20Regular, PanelRightExpand20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { createElement } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type {
  ContextMenuCommand,
  ContextMenuSeparator,
} from '../../kit/context-menu/contextMenuItems.ts';
import { divider } from '../../track/trackMenuEntries.ts';
import { useSceneActions } from '../scene/sceneContext.ts';

/**
 * 构建侧栏展开/收起菜单项与后置分隔线
 *
 * 封面列居中时提供「展开侧栏」，展开状态下提供「收起侧栏」；通过场景动作触发联动视图过渡
 */
export function useSidebarMenuItems(
  centered: boolean,
): readonly [ContextMenuCommand, ContextMenuSeparator] {
  const t = useAtomValueRawSync(translateAtom);
  const actions = useSceneActions();
  return [
    {
      kind: 'command',
      id: 'sidebar',
      label: t(centered ? 'immersive.expandSidebar' : 'immersive.collapseSidebar'),
      icon: createElement(centered ? PanelRightExpand20Regular : PanelRightContract20Regular),
      onSelect: () => actions.setSidebar(centered ? 'open' : 'closed'),
    },
    divider('sidebar-divider'),
  ];
}
