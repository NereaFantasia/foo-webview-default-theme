import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import { startCommandRegistry } from '../../../src/nav/commandRegistry.ts';
import { registerFullscreenCommand } from '../../../src/nav/fullscreenCommand.ts';
import { registerNavCommands } from '../../../src/nav/navCommands.ts';
import { startNavHistory } from '../../../src/nav/navHistory.ts';
import { QUEUE_KEYS } from '../../../src/nav/queueKeys.ts';
import {
  chordKeys,
  SHORTCUT_SECTIONS,
  type ShortcutInput,
} from '../../../src/settings/shortcutList.ts';

/** 一览里某一条列的键盘按法。 */
function chordsOf(label: string) {
  const entry = SHORTCUT_SECTIONS.flatMap((section) => section.entries).find(
    (candidate) => candidate.label === label,
  );
  return (entry?.inputs ?? []).flatMap((input: ShortcutInput) =>
    'chord' in input ? [input.chord] : [],
  );
}

describe('chordKeys', () => {
  it('修饰键在前，方向键写成箭头', () => {
    expect(chordKeys({ key: 'ArrowLeft', alt: true })).toEqual(['Alt', '←']);
    expect(chordKeys({ key: 'ArrowDown', alt: true, shift: true })).toEqual(['Alt', 'Shift', '↓']);
  });

  it('单个字母写成大写，空格与 Esc 写成键帽上的字，功能键原样', () => {
    expect(chordKeys({ key: 'f', ctrl: true })).toEqual(['Ctrl', 'F']);
    expect(chordKeys({ key: ' ' })).toEqual(['Space']);
    expect(chordKeys({ key: 'Escape' })).toEqual(['Esc']);
    expect(chordKeys({ key: 'F2' })).toEqual(['F2']);
    expect(chordKeys({ key: 'p', ctrl: true, shift: true, meta: true })).toEqual([
      'Ctrl',
      'Shift',
      'Win',
      'P',
    ]);
  });
});

describe('SHORTCUT_SECTIONS', () => {
  it('队列一览与实际按键共用声明，包含重做的两种按法', () => {
    expect(chordsOf('queue.menu.playNow')).toEqual(QUEUE_KEYS.play);
    expect(chordsOf('queue.menu.remove')).toEqual(QUEUE_KEYS.remove);
    expect(chordsOf('queue.undo')).toEqual(QUEUE_KEYS.undo);
    expect(chordsOf('queue.redo')).toEqual(QUEUE_KEYS.redo);
  });
  it('后退、前进列的按键就是登记处里那两条命令的按键', () => {
    const commands = startCommandRegistry(null);
    registerNavCommands(commands, startNavHistory(createStore()));
    const keysOf = (id: string) => commands.list().find((spec) => spec.id === id)?.keys;
    expect(chordsOf('settings.shortcutBack')).toEqual(keysOf('nav.back'));
    expect(chordsOf('settings.shortcutForward')).toEqual(keysOf('nav.forward'));
  });

  it('全屏列的按键就是登记处里全屏命令的按键', () => {
    const commands = startCommandRegistry(null);
    registerFullscreenCommand(commands);
    const keys = commands.list().find((spec) => spec.id === 'window.fullscreen')?.keys;
    expect(chordsOf('settings.shortcutFullscreen')).toEqual(keys);
  });

  it('每一条至少有一种按法，名字都在语言包里', () => {
    const entries = SHORTCUT_SECTIONS.flatMap((section) => section.entries);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.inputs.length).toBeGreaterThan(0);
      expect(en[entry.label]).not.toBe('');
    }
  });
});
