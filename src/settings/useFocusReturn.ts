import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useLayoutEffect, type RefObject } from 'react';
import { historyAtom } from '../nav/navHistory.ts';
import { SIDEBAR_KEY_ATTR } from '../nav/sidebar/SidebarKey.tsx';
import { itemKey } from '../nav/sidebar/sidebarNav.ts';
import { PageEntryContext } from '../nav/usePageSnapshot.ts';

/** 焦点交给谁：侧边栏里看得见的「设置」项；侧边栏没显示（窄窗、被藏起来）时给导航行的侧边栏键。 */
function returnTarget(): HTMLElement | null {
  const indicator = `[data-nav-indicator="${CSS.escape(itemKey('settings'))}"]`;
  for (const mark of document.querySelectorAll(indicator)) {
    const item = mark.closest<HTMLElement>('button, a');
    if (item?.checkVisibility()) return item;
  }
  return document.querySelector<HTMLElement>(`[${SIDEBAR_KEY_ATTR}]`);
}

/**
 * 离开设置页时，焦点还在页里就交还出去。离场的页面会被设成不接焦点，浏览器随后把焦点丢到 body 上，
 * 键盘就得从头找起；这里赶在那之前，在换地点的同一次提交里把焦点移走。
 */
export function useFocusReturn(root: RefObject<HTMLElement | null>): void {
  const own = useContext(PageEntryContext);
  const { entry } = useAtomValueRawSync(historyAtom);
  const leaving = own !== null && entry !== own;
  useLayoutEffect(() => {
    if (!leaving || !root.current?.contains(document.activeElement)) return;
    returnTarget()?.focus({ preventScroll: true });
  }, [leaving, root]);
}
