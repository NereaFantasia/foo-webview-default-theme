// @vitest-environment jsdom
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCommandRegistry } from '../../../src/nav/commandRegistry.ts';
import { CommandsContext } from '../../../src/nav/useCommand.ts';
import { useLightDismiss } from '../../../src/nav/useLightDismiss.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  document.body.replaceChildren();
});

function Panel(props: { exempt?: (target: Element) => boolean; onDismiss: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const markInside = useLightDismiss({
    id: 'test.dismiss',
    open: true,
    panel,
    exempt: props.exempt,
    onDismiss: props.onDismiss,
  });
  return createElement('div', { ref: panel, id: 'panel', onPointerDownCapture: markInside });
}

function mount(props: Parameters<typeof Panel>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const commands = startCommandRegistry(null);
  act(() =>
    root.render(
      createElement(CommandsContext.Provider, { value: commands }, createElement(Panel, props)),
    ),
  );
}

function pointerDown(target: Element) {
  act(() => {
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  });
}

function element(markup: string): Element {
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  const node = holder.firstElementChild;
  if (!node) throw new Error('没有生成元素');
  document.body.append(node);
  return node;
}

describe('useLightDismiss 在外面按下', () => {
  it('按在浮层外面收起，焦点不用还（escape 为假）', () => {
    const onDismiss = vi.fn();
    mount({ onDismiss });
    pointerDown(element('<p>外面</p>'));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('按在放行区域里不收', () => {
    const onDismiss = vi.fn();
    mount({ onDismiss, exempt: (target) => target.closest('[data-keep]') !== null });
    pointerDown(element('<p data-keep><span>放行</span></p>').firstElementChild ?? document.body);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('按在右键菜单层里不收：文本框的编辑菜单挂在浮层的组件树之外', () => {
    const onDismiss = vi.fn();
    mount({ onDismiss });
    const item = element('<div data-context-menu-owner="m1"><button>粘贴</button></div>');
    pointerDown(item.querySelector('button') ?? item);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('按在浮层自己里面不收', () => {
    const onDismiss = vi.fn();
    mount({ onDismiss });
    pointerDown(document.getElementById('panel') ?? document.body);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
