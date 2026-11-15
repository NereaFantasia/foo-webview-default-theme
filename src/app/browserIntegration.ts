import { atom } from 'jotai/vanilla';
import { miniWindowAtom } from '../host/miniWindow.ts';
import type { Store } from '../kit/store.ts';
import { startBrowserPanel, type BrowserPanelService } from '../nav/browserPanel.ts';
import type { StackHistoryService } from '../nav/navHistory.ts';
import { sidebarViewAtom } from '../nav/sidebar/sidebarView.ts';

/**
 * 装配沉浸视图里的浏览面板：面板此刻能不能用取决于窗口。窗口窄到侧边栏收起（宽度 ≤ 640）、
 * 或是迷你窗口时用不了，开着的面板随之收起
 */
export function startBrowserIntegration(
  store: Store,
  deps: { readonly main: StackHistoryService },
): BrowserPanelService {
  const available = atom(
    (get) => get(sidebarViewAtom).tier !== 'hidden' && !get(miniWindowAtom).active,
  );
  return startBrowserPanel(store, { main: deps.main, available });
}
