import type { MessageKey } from '../i18n/en.ts';
import type { KeyChord } from '../nav/commandRegistry.ts';
import { FULLSCREEN_KEYS } from '../nav/fullscreenCommand.ts';
import { BACK_KEYS, FORWARD_KEYS } from '../nav/navCommands.ts';
import { QUEUE_KEYS } from '../nav/queueKeys.ts';

/** 一种按法：键盘上的一个组合，或鼠标的一个键（`mouse` 是这个键的名字的文案键）。 */
export type ShortcutInput = { readonly chord: KeyChord } | { readonly mouse: MessageKey };

export interface ShortcutEntry {
  /** 这个操作的名字。 */
  readonly label: MessageKey;
  /** 几种按法任选其一。 */
  readonly inputs: readonly ShortcutInput[];
}

export interface ShortcutSection {
  /** 这些按键在哪里起作用。 */
  readonly title: MessageKey;
  readonly entries: readonly ShortcutEntry[];
}

const chords = (keys: readonly KeyChord[]): ShortcutInput[] => keys.map((chord) => ({ chord }));

/**
 * 快捷键一览的内容，按起作用的地方分小节。
 *
 * 这是一张静态清单：命令要等所在的页面或部件挂上才登记，设置页里问不到别处的命令。后退、前进与全屏取登记
 * 它们的模块给的按键，队列按键取共享声明；其余几条照实写在这里，改了那边的按键要跟着改这里。
 */
export const SHORTCUT_SECTIONS: readonly ShortcutSection[] = [
  {
    title: 'settings.shortcutsGlobal',
    entries: [
      {
        label: 'settings.shortcutBack',
        inputs: [...chords(BACK_KEYS), { mouse: 'settings.mouseBack' }],
      },
      {
        label: 'settings.shortcutForward',
        inputs: [...chords(FORWARD_KEYS), { mouse: 'settings.mouseForward' }],
      },
      { label: 'settings.shortcutFullscreen', inputs: chords(FULLSCREEN_KEYS) },
    ],
  },
  {
    title: 'settings.shortcutsPlaylists',
    entries: [
      { label: 'settings.shortcutRename', inputs: [{ chord: { key: 'F2' } }] },
      { label: 'settings.shortcutMoveUp', inputs: [{ chord: { key: 'ArrowUp', alt: true } }] },
      { label: 'settings.shortcutMoveDown', inputs: [{ chord: { key: 'ArrowDown', alt: true } }] },
    ],
  },
  {
    title: 'queue.shortcuts',
    entries: [
      { label: 'queue.menu.playNow', inputs: chords(QUEUE_KEYS.play) },
      { label: 'queue.menu.remove', inputs: chords(QUEUE_KEYS.remove) },
      { label: 'settings.shortcutMoveUp', inputs: chords(QUEUE_KEYS.moveUp) },
      { label: 'settings.shortcutMoveDown', inputs: chords(QUEUE_KEYS.moveDown) },
      { label: 'queue.undo', inputs: chords(QUEUE_KEYS.undo) },
      { label: 'queue.redo', inputs: chords(QUEUE_KEYS.redo) },
      { label: 'queue.more', inputs: chords(QUEUE_KEYS.menu) },
    ],
  },
];

/** `KeyboardEvent.key` 里写出来不像键帽上的字的那几个。 */
const KEY_NAMES: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ' ': 'Space',
  Escape: 'Esc',
};

/** 一个组合拆成几个键帽上的字，修饰键在前。按键名不翻译；单个字母写成大写。 */
export function chordKeys(chord: KeyChord): string[] {
  const keys: string[] = [];
  if (chord.ctrl) keys.push('Ctrl');
  if (chord.alt) keys.push('Alt');
  if (chord.shift) keys.push('Shift');
  if (chord.meta) keys.push('Win');
  const name = KEY_NAMES[chord.key] ?? chord.key;
  keys.push(name.length === 1 ? name.toUpperCase() : name);
  return keys;
}
