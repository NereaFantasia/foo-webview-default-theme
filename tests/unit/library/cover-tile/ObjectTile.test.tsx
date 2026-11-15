// @vitest-environment jsdom
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectTile } from '../../../../src/library/cover-tile/ObjectTile.tsx';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

describe('ObjectTile 悬停按钮的取色', () => {
  let environment: ActEnvironment;
  let host: HTMLDivElement;
  let root: Root;

  // 第一次载入界面库要几秒，先热一遍，免得算进第一个用例的超时里
  beforeAll(async () => {
    await import('../../../../src/library/cover-tile/ObjectTile.tsx');
  }, 60_000);

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  });

  function mount(keysTheme?: (keys: ReactElement) => ReactNode) {
    act(() =>
      root.render(
        createElement(ObjectTile, {
          art: null,
          title: 'Album',
          onOpen: () => {},
          onMenu: () => {},
          onPlay: () => {},
          ...(keysTheme ? { keysTheme } : {}),
        }),
      ),
    );
  }

  function hover() {
    const tile = host.firstElementChild;
    if (!tile) throw new Error('图块没渲染出来');
    act(() => {
      tile.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });
  }

  it('没悬停过不挂按钮；给了 keysTheme，首次悬停挂上的按钮在它包的那一层里，取色不随所在页面走', () => {
    mount((keys) => createElement('div', { 'data-keys-theme': '' }, keys));
    expect(host.querySelector('[data-tile-play]')).toBeNull();
    hover();
    const wrapper = host.querySelector('[data-keys-theme]');
    const play = host.querySelector('[data-tile-play]');
    expect(play).not.toBeNull();
    expect(wrapper?.contains(play)).toBe(true);
  });

  it('没给 keysTheme：按钮直接挂在图块里，行为不变', () => {
    mount();
    hover();
    expect(host.querySelector('[data-tile-play]')).not.toBeNull();
    expect(host.querySelector('[data-keys-theme]')).toBeNull();
  });
});
