// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SceneView } from '../../../../src/immersive/scene/sceneState.ts';
import { useSideScene } from '../../../../src/immersive/scene/useSideScene.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

function viewOf(overrides: Partial<SceneView>): SceneView {
  return {
    mode: 'none',
    page: 'lyrics',
    centered: false,
    autoCentered: false,
    showTabs: true,
    showSidebarEntry: true,
    sidebarOpen: false,
    ...overrides,
  };
}

let host: HTMLDivElement;

function Probe({ scene }: { readonly scene: SceneView }) {
  const side = useSideScene(scene);
  return createElement('span', { 'data-page': side.page, 'data-open': String(side.open) });
}

function show(scene: SceneView): void {
  const root = createRoot(host);
  act(() => root.render(createElement(Probe, { scene })));
}

function shown(): { page: string | undefined; open: string | undefined } {
  const element = host.querySelector('span');
  return { page: element?.dataset.page, open: element?.dataset.open };
}

describe('useSideScene：居中时侧栏沿用居中前最后一次画的页', () => {
  beforeEach(() => {
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
  });
  afterEach(() => {
    host.remove();
  });

  it('没居中时跟着实时的页与展开状态走', () => {
    show(viewOf({ page: 'history', sidebarOpen: true }));
    expect(shown()).toEqual({ page: 'history', open: 'true' });
  });

  it('同一帧切到居中又换了页（队列回到没有歌词的歌词页）：退场的栏里还是队列，不是空栏', () => {
    const root = createRoot(host);
    act(() => root.render(createElement(Probe, { scene: viewOf({ page: 'queue' }) })));
    act(() =>
      root.render(
        createElement(Probe, {
          scene: viewOf({ page: 'lyrics', centered: true, sidebarOpen: true }),
        }),
      ),
    );
    expect(shown()).toEqual({ page: 'queue', open: 'false' });
    act(() => root.render(createElement(Probe, { scene: viewOf({ page: 'lyrics' }) })));
    expect(shown()).toEqual({ page: 'lyrics', open: 'false' });
  });
});
