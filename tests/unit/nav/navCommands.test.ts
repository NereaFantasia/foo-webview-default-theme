import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { startCommandRegistry, type KeyInput } from '../../../src/nav/commandRegistry.ts';
import { BACK_BUTTON, FORWARD_BUTTON, registerNavCommands } from '../../../src/nav/navCommands.ts';
import { historyAtom, startNavHistory } from '../../../src/nav/navHistory.ts';

function alt(key: string): KeyInput {
  return {
    key,
    altKey: true,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault() {},
  };
}

function button(value: number) {
  return { type: 'mouseup', button: value, defaultPrevented: false, preventDefault() {} };
}

function setup() {
  const store = createStore();
  const history = startNavHistory(store, { id: 'home' });
  const commands = startCommandRegistry(null);
  const dispose = registerNavCommands(commands, history);
  return { history, commands, dispose, place: () => store.get(historyAtom).place };
}

describe('registerNavCommands', () => {
  it('Alt+← / → 与鼠标后退、前进键走全局历史', () => {
    const { history, commands, place } = setup();
    history.navigate({ id: 'albums' });

    expect(commands.dispatchKey(alt('ArrowLeft'))).toBe('nav.back');
    expect(place()).toEqual({ id: 'home' });
    expect(commands.dispatchKey(alt('ArrowRight'))).toBe('nav.forward');
    expect(place()).toEqual({ id: 'albums' });
    expect(commands.dispatchButton(button(BACK_BUTTON))).toBe('nav.back');
    expect(place()).toEqual({ id: 'home' });
    expect(commands.dispatchButton(button(FORWARD_BUTTON))).toBe('nav.forward');
    expect(place()).toEqual({ id: 'albums' });
  });

  it('退不回去时照样认领，输入不落到 WebView2 的缺省后退上', () => {
    const { commands, place } = setup();
    expect(commands.dispatchKey(alt('ArrowLeft'))).toBe('nav.back');
    expect(commands.dispatchButton(button(BACK_BUTTON))).toBe('nav.back');
    expect(place()).toEqual({ id: 'home' });
  });

  it('注销后两条都不在了', () => {
    const { commands, dispose } = setup();
    dispose();
    expect(commands.list()).toEqual([]);
  });
});
