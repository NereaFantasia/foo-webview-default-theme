import { Provider } from 'jotai/react';
import { createStore } from 'jotai/vanilla';
import { useContext, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImmersiveTheme } from '../../../../src/immersive/page/ImmersiveTheme.tsx';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';
import { COLOR_MODE_STORAGE_KEY, watchColorScheme } from '../../../../src/theme/colorScheme.ts';
import { MenuBackgroundContext } from '../../../../src/theme/MenuSurface.tsx';
import { PanelBackgroundContext } from '../../../../src/theme/PopoverSurface.tsx';

const WINDOW_MENU = 'window-menu';
const WINDOW_PANEL = 'window-panel';

function Probe() {
  const menu = useContext(MenuBackgroundContext);
  const panel = useContext(PanelBackgroundContext);
  return <i data-menu={menu ?? 'none'} data-panel={panel ?? 'none'} />;
}

/** 整窗按 `windowScheme` 定深浅，主题根算好的浮层底色经上下文传下来 */
function render(windowScheme: 'light' | 'dark', element: ReactNode): string {
  const store = createStore();
  const storage: PrefStorage = {
    getItem: (key) => (key === COLOR_MODE_STORAGE_KEY ? windowScheme : null),
    setItem: () => {},
  };
  watchColorScheme(store, null, storage)();
  return renderToStaticMarkup(
    <Provider store={store}>
      <PanelBackgroundContext value={WINDOW_PANEL}>
        <MenuBackgroundContext value={WINDOW_MENU}>{element}</MenuBackgroundContext>
      </PanelBackgroundContext>
    </Provider>,
  );
}

describe('ImmersiveTheme 的浮层底色', () => {
  it('固定的深浅与整窗相反时，撤掉主题根传来的菜单与面板底色', () => {
    const html = render(
      'light',
      <ImmersiveTheme scheme="dark">
        <Probe />
      </ImmersiveTheme>,
    );
    expect(html).toContain('data-menu="none"');
    expect(html).toContain('data-panel="none"');
  });

  it('固定的深浅与整窗相同时，沿用主题根传来的底色', () => {
    const html = render(
      'dark',
      <ImmersiveTheme scheme="dark">
        <Probe />
      </ImmersiveTheme>,
    );
    expect(html).toContain(`data-menu="${WINDOW_MENU}"`);
    expect(html).toContain(`data-panel="${WINDOW_PANEL}"`);
  });

  it('没有固定深浅时跟整窗走，沿用主题根传来的底色', () => {
    const html = render(
      'light',
      <ImmersiveTheme>
        <Probe />
      </ImmersiveTheme>,
    );
    expect(html).toContain(`data-menu="${WINDOW_MENU}"`);
    expect(html).toContain(`data-panel="${WINDOW_PANEL}"`);
  });
});
