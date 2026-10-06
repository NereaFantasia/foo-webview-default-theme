import { describe, expect, it } from 'vitest';
import { startCommandRegistry, type KeyInput } from '../../../src/nav/commandRegistry.ts';
import {
  FULLSCREEN_KEYS,
  registerFullscreenCommand,
  type FullscreenFace,
} from '../../../src/nav/fullscreenCommand.ts';

function press(key: string, modifiers: { ctrl?: boolean } = {}): KeyInput {
  return {
    key,
    altKey: false,
    ctrlKey: modifiers.ctrl ?? false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault() {},
  };
}

function setup(available = true) {
  const toggles: string[] = [];
  const host: FullscreenFace = {
    isAvailable: () => available,
    ui: {
      toggleFullscreen: async () => {
        toggles.push('toggle');
        return { success: true, fullscreen: true };
      },
    },
  };
  const commands = startCommandRegistry(null);
  const dispose = registerFullscreenCommand(commands, host);
  return { commands, dispose, toggles };
}

describe('registerFullscreenCommand', () => {
  it('F11 让宿主切换主窗全屏，按键给的就是登记的那一份', () => {
    const { commands, toggles } = setup();
    expect(commands.dispatchKey(press('F11'))).toBe('window.fullscreen');
    expect(toggles).toEqual(['toggle']);
    expect(commands.list().find((spec) => spec.id === 'window.fullscreen')?.keys).toEqual(
      FULLSCREEN_KEYS,
    );
  });

  it('带修饰键的 F11 不认领', () => {
    const { commands, toggles } = setup();
    expect(commands.dispatchKey(press('F11', { ctrl: true }))).toBeNull();
    expect(toggles).toEqual([]);
  });

  it('没有宿主时不认领，按键照浏览器的缺省走', () => {
    const { commands, toggles } = setup(false);
    expect(commands.dispatchKey(press('F11'))).toBeNull();
    expect(toggles).toEqual([]);
  });

  it('注销后登记处里不剩这一条', () => {
    const { commands, dispose } = setup();
    dispose();
    expect(commands.list()).toEqual([]);
  });
});
