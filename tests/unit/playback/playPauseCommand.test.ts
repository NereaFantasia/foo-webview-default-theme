import { describe, expect, it } from 'vitest';
import { startCommandRegistry, type KeyInput } from '../../../src/nav/commandRegistry.ts';
import {
  registerPlayPauseCommand,
  type FocusElement,
} from '../../../src/playback/playPauseCommand.ts';

function space(init: Partial<KeyInput> = {}): KeyInput {
  return {
    key: ' ',
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

/** 替身元素：`closest` 只认它声明的选择器，`focusVisible` 决定是不是键盘聚焦 */
function element(selectors: readonly string[], focusVisible = false): FocusElement {
  return {
    closest: (query) => (query.split(/\s*,\s*/).some((one) => selectors.includes(one)) ? {} : null),
    matches: (query) => focusVisible && query === ':focus-visible',
  };
}

function setup(active: FocusElement | null) {
  let toggles = 0;
  const commands = startCommandRegistry(null);
  const dispose = registerPlayPauseCommand(
    commands,
    {
      playOrPause: async () => {
        toggles += 1;
      },
    },
    () => active,
  );
  return { commands, dispose, toggles: () => toggles };
}

describe('registerPlayPauseCommand', () => {
  it('焦点在页面空白处（没有焦点元素）时，空格切换播放', () => {
    const { commands, toggles } = setup(null);
    expect(commands.dispatchKey(space())).toBe('playback.playPause');
    expect(toggles()).toBe(1);
  });

  it.each([
    ['输入框', 'input'],
    ['文本域', 'textarea'],
    ['可编辑内容', '[contenteditable]'],
    ['滑块', '[role="slider"]'],
    ['菜单项所在的菜单', '[role="menu"]'],
    ['对话框', '[role="dialog"]'],
  ])('焦点在%s里时空格留给它', (_name, selector) => {
    const { commands, toggles } = setup(element([selector]));
    expect(commands.dispatchKey(space())).toBeNull();
    expect(toggles()).toBe(0);
  });

  it('键盘聚焦的按钮留着空格，鼠标点过的按钮不留', () => {
    const keyboard = setup(element(['button'], true));
    expect(keyboard.commands.dispatchKey(space())).toBeNull();
    expect(keyboard.toggles()).toBe(0);

    const mouse = setup(element(['button'], false));
    expect(mouse.commands.dispatchKey(space())).toBe('playback.playPause');
    expect(mouse.toggles()).toBe(1);
  });

  it('按住空格的自动重复不认领', () => {
    const { commands, toggles } = setup(null);
    expect(commands.dispatchKey(space({ repeat: true }))).toBeNull();
    expect(toggles()).toBe(0);
  });

  it('带修饰键的空格与输入法组字中的空格不认领', () => {
    const { commands, toggles } = setup(null);
    expect(commands.dispatchKey(space({ ctrlKey: true }))).toBeNull();
    expect(commands.dispatchKey(space({ isComposing: true }))).toBeNull();
    expect(toggles()).toBe(0);
  });

  it('更高层登记的空格先于它', () => {
    const { commands, toggles } = setup(null);
    const placed: string[] = [];
    commands.register({
      id: 'place.space',
      layer: 'place',
      keys: [{ key: ' ' }],
      run: () => placed.push('place'),
    });
    expect(commands.dispatchKey(space())).toBe('place.space');
    expect(placed).toEqual(['place']);
    expect(toggles()).toBe(0);
  });

  it('注销后不再认领', () => {
    const { commands, dispose } = setup(null);
    dispose();
    expect(commands.dispatchKey(space())).toBeNull();
  });
});
