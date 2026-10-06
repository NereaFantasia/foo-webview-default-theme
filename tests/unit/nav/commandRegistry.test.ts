import { describe, expect, it, vi } from 'vitest';
import {
  startCommandRegistry,
  type ButtonInput,
  type InputTarget,
  type KeyInput,
} from '../../../src/nav/commandRegistry.ts';

type Listener = (event: KeyInput & ButtonInput) => void;

/** 替身目标：按事件类型与阶段记下监听，`fire` 把一个事件交给它们。 */
function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  const slot = (type: string, capture = false) => `${type}:${capture ? 'capture' : 'bubble'}`;
  const target: InputTarget = {
    addEventListener(type: string, listener: Listener, capture?: boolean) {
      const key = slot(type, capture);
      listeners.set(key, (listeners.get(key) ?? new Set()).add(listener));
    },
    removeEventListener(type: string, listener: Listener, capture?: boolean) {
      listeners.get(slot(type, capture))?.delete(listener);
    },
  };
  function fire(type: string, init: Partial<KeyInput & ButtonInput>, capture = false) {
    const event = {
      type,
      key: '',
      button: 0,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      metaKey: false,
      isComposing: false,
      defaultPrevented: false,
      ...init,
      preventDefault() {
        event.defaultPrevented = true;
      },
    };
    for (const listener of listeners.get(slot(type, capture)) ?? []) listener(event);
    return event;
  }
  const count = () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
  return { target, fire, count };
}

function key(value: string, init: Partial<KeyInput> = {}): KeyInput {
  return {
    key: value,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault() {},
    ...init,
  };
}

describe('startCommandRegistry', () => {
  it('浮层开着时 Esc 交给浮层，页面里获焦的输入框收不到；浮层关了才轮到它', () => {
    const commands = startCommandRegistry(null);
    let menuOpen = true;
    const closeMenu = vi.fn(() => {
      menuOpen = false;
    });
    const clearFilter = vi.fn();
    commands.register({
      id: 'filter.clear',
      layer: 'input',
      keys: [{ key: 'Escape' }],
      run: clearFilter,
    });
    commands.register({
      id: 'menu.close',
      layer: 'overlay',
      keys: [{ key: 'Escape' }],
      enabled: () => menuOpen,
      run: closeMenu,
    });

    expect(commands.dispatchKey(key('Escape'))).toBe('menu.close');
    expect(clearFilter).not.toHaveBeenCalled();
    expect(commands.dispatchKey(key('Escape'))).toBe('filter.clear');
    expect(closeMenu).toHaveBeenCalledTimes(1);
  });

  it('列表部件、当前地点与全局三层不许认领 Esc', () => {
    const commands = startCommandRegistry(null);
    for (const layer of ['widget', 'place', 'global'] as const) {
      expect(() =>
        commands.register({ id: `x.${layer}`, layer, keys: [{ key: 'escape' }], run: () => {} }),
      ).toThrow(/Esc/);
    }
    expect(commands.list()).toEqual([]);
  });

  it('高层先问；同一层后登记的先问；不可用的不认领，往下一层走', () => {
    const commands = startCommandRegistry(null);
    const run = vi.fn();
    let gridFocused = false;
    commands.register({
      id: 'nav.back',
      layer: 'global',
      keys: [{ key: 'ArrowLeft', alt: true }],
      run,
    });
    commands.register({
      id: 'columns.left',
      layer: 'widget',
      keys: [{ key: 'ArrowLeft', alt: true }],
      enabled: () => gridFocused,
      run,
    });
    expect(commands.dispatchKey(key('ArrowLeft', { altKey: true }))).toBe('nav.back');
    gridFocused = true;
    expect(commands.dispatchKey(key('ArrowLeft', { altKey: true }))).toBe('columns.left');

    commands.register({ id: 'first', layer: 'overlay', keys: [{ key: 'Enter' }], run });
    commands.register({ id: 'second', layer: 'overlay', keys: [{ key: 'Enter' }], run });
    expect(commands.dispatchKey(key('Enter'))).toBe('second');
  });

  it('修饰键要完全对上；字母不分大小写', () => {
    const commands = startCommandRegistry(null);
    commands.register({
      id: 'nav.back',
      layer: 'global',
      keys: [{ key: 'ArrowLeft', alt: true }],
      run: () => {},
    });
    commands.register({
      id: 'search',
      layer: 'global',
      keys: [{ key: 'f', ctrl: true }],
      run: () => {},
    });
    expect(commands.dispatchKey(key('ArrowLeft'))).toBeNull();
    expect(commands.dispatchKey(key('ArrowLeft', { altKey: true, shiftKey: true }))).toBeNull();
    expect(commands.dispatchKey(key('F', { ctrlKey: true }))).toBe('search');
  });

  it('元素自己处理过的键与输入法组字中的键都不接手', () => {
    const commands = startCommandRegistry(null);
    const run = vi.fn();
    commands.register({ id: 'close', layer: 'overlay', keys: [{ key: 'Escape' }], run });
    expect(commands.dispatchKey(key('Escape', { defaultPrevented: true }))).toBeNull();
    expect(commands.dispatchKey(key('Escape', { isComposing: true }))).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('同一个 id 再登记顶替旧的；注销后不再认领', () => {
    const commands = startCommandRegistry(null);
    const older = vi.fn();
    const newer = vi.fn();
    commands.register({ id: 'play', layer: 'place', keys: [{ key: 'Enter' }], run: older });
    const unregister = commands.register({
      id: 'play',
      layer: 'place',
      keys: [{ key: 'Enter' }],
      run: newer,
    });
    commands.dispatchKey(key('Enter'));
    expect(older).not.toHaveBeenCalled();
    expect(newer).toHaveBeenCalledTimes(1);
    expect(commands.list()).toHaveLength(1);
    unregister();
    expect(commands.dispatchKey(key('Enter'))).toBeNull();
  });

  describe('挂在目标上', () => {
    it('键盘在冒泡阶段接手，接手了才拦缺省', () => {
      const { target, fire } = fakeTarget();
      const commands = startCommandRegistry(target);
      commands.register({
        id: 'nav.back',
        layer: 'global',
        keys: [{ key: 'ArrowLeft', alt: true }],
        run: () => {},
      });
      expect(fire('keydown', { key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(true);
      expect(fire('keydown', { key: 'ArrowRight', altKey: true }).defaultPrevented).toBe(false);
    });

    it('声明过的鼠标键在按下、松开、辅助点击三处都拦缺省，只在松开时执行；不可用时照样拦', () => {
      const { target, fire } = fakeTarget();
      const commands = startCommandRegistry(target);
      const run = vi.fn();
      let enabled = true;
      commands.register({
        id: 'nav.back',
        layer: 'global',
        buttons: [3],
        enabled: () => enabled,
        run,
      });

      for (const type of ['mousedown', 'mouseup', 'auxclick']) {
        expect(fire(type, { button: 3 }, true).defaultPrevented).toBe(true);
      }
      expect(run).toHaveBeenCalledTimes(1);

      enabled = false;
      expect(fire('mouseup', { button: 3 }, true).defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
      // 没人声明的键（右键）不碰。
      expect(fire('mouseup', { button: 2 }, true).defaultPrevented).toBe(false);
    });

    it('释放后摘掉全部监听', () => {
      const { target, count } = fakeTarget();
      const commands = startCommandRegistry(target);
      expect(count()).toBe(4);
      commands.dispose();
      expect(count()).toBe(0);
    });
  });
});
