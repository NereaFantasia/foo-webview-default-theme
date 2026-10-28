import { mergeClasses, Button, Tooltip } from '@fluentui/react-components';
import { PanelLeft16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { sidebarPrefsAtom, sidebarPrefsKey } from './sidebarPrefs.ts';
import { sidebarViewAtom, sidebarViewKey } from './sidebarView.ts';
import { useService } from '../../kit/useService.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

export interface SidebarKeyProps {
  readonly className?: string;
  /** 圆形悬停底（导航行的描边圆里）；为假时是标题栏工具键的圆角方形。缺省为真 */
  readonly round?: boolean;
}

/** 侧边栏键的标记：侧边栏的浮层按它认，点它不算点在浮层外面；侧边栏卸掉时焦点也交给它 */
export const SIDEBAR_KEY_ATTR = 'data-sidebar-key';

/**
 * 锚在侧边栏上、却经 Portal 挂在别处的浮层的标记，如从侧边栏搜索框弹出的下拉：
 * 点它不算点在侧边栏浮层外面，它开着时悬停预览也不收，否则点下拉里的页签会把侧边栏收掉、下拉跟着位移
 */
export const SIDEBAR_COMPANION_ATTR = 'data-sidebar-companion';

/**
 * 侧边栏键（在导航行或标题栏里）。窗口够宽（≥ 1008）时把侧边栏整个藏起来，再按一次照原来的形态
 * （展开或图标态、原来的宽度）摆回来；图标态与展开之间的切换归握柄。窗口窄时侧边栏由不得用户
 * （641–1007 恒为图标态，≤ 640 不显示），这个键改成以浮层展开整张侧边栏，再按一次收起
 */
export function SidebarKey({ className, round = true }: SidebarKeyProps) {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const { hidden } = useAtomValueRawSync(sidebarPrefsAtom);
  const { tier, overlay, peeking } = useAtomValueRawSync(sidebarViewAtom);
  const sidebar = useService(sidebarPrefsKey);
  const sidebarView = useService(sidebarViewKey);
  const [tip, setTip] = useState(false);
  const own = tier === 'wide';
  const expanded = overlay || (own && !hidden);
  let label: MessageKey = overlay && !peeking ? 'sidebar.collapse' : 'sidebar.expand';
  if (own) label = hidden ? 'sidebar.show' : 'sidebar.hide';
  return (
    <Tooltip
      content={t(label)}
      relationship="label"
      visible={tip && !overlay}
      onVisibleChange={(_, data) => setTip(data.visible)}
    >
      <Button
        appearance="subtle"
        shape={round ? 'circular' : 'rounded'}
        className={mergeClasses(className, viewControls.icon)}
        icon={<PanelLeft16Regular />}
        aria-expanded={expanded}
        {...{ [SIDEBAR_KEY_ATTR]: true }}
        onClick={() => (own ? sidebar.toggleHidden() : sidebarView.toggleOverlay())}
      />
    </Tooltip>
  );
}
