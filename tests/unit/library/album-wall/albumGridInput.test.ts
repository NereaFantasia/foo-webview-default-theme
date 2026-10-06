import { describe, expect, it } from 'vitest';
import {
  createAlbumGridInput,
  type GridInputSink,
  type GridKeyEvent,
} from '../../../../src/library/album-wall/albumGridInput.ts';
import type { GridPosition } from '../../../../src/library/album-wall/albumGridKeys.ts';
import { buildGridItems } from '../../../../src/library/album-wall/albumGridLayout.ts';
import type { Album } from '../../../../src/host/libraryContract.ts';
import type { Modifiers } from '../../../../src/kit/keyedSelection.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';

const [a, b, c] = ['Alpha', 'Beta', 'Gamma'].map((name) => albumRow(name, 'Band'));
const items = buildGridItems([{ key: 'Jazz', albums: [a!, b!, c!] }], new Set(), 2, {
  headers: true,
  repeats: false,
});

function setup(start?: GridPosition) {
  let position = start;
  const log: string[] = [];
  const name = (album: Album) => album.name;
  const mods = (modifiers?: Modifiers) =>
    modifiers ? `${modifiers.ctrl ? 'C' : ''}${modifiers.shift ? 'S' : ''}-` : '';
  const sink: GridInputSink = {
    focus: (album, at, modifiers) => {
      if (at) position = at;
      log.push(`focus ${mods(modifiers)}${name(album)}`);
    },
    selectAll: () => log.push('selectAll'),
    play: (album) => log.push(`play ${name(album)}`),
    zoom: (notches) => log.push(`zoom ${notches}`),
    scrollTo: (index) => log.push(`scroll ${index}`),
    contextMenu: (album, point) => log.push(`menu ${name(album)} ${point.x},${point.y}`),
    toggle: (album, section) => log.push(`toggle ${name(album)} ${section}`),
  };
  const input = createAlbumGridInput(
    {
      items: () => items,
      position: () => position,
      pageRows: () => 2,
      menuAnchor: () => ({ x: 10, y: 20 }),
    },
    sink,
  );
  let prevented = 0;
  const key = (value: string, extra: Partial<GridKeyEvent> = {}) =>
    input.keydown({ key: value, preventDefault: () => (prevented += 1), ...extra });
  return { input, log, key, prevented: () => prevented };
}

describe('createAlbumGridInput', () => {
  it('移动键落焦点、带着修饰键改选中并滚进视口', () => {
    const { log, key } = setup({ index: 1, column: 0 });
    key('ArrowRight');
    key('ArrowDown', { shiftKey: true });
    key('ArrowLeft', { ctrlKey: true });
    expect(log).toEqual([
      'focus -Beta',
      'scroll 1',
      'focus S-Gamma',
      'scroll 2',
      'focus C-Beta',
      'scroll 1',
    ]);
  });

  it('回车播放焦点那张，空格开合它的下拉', () => {
    const { log, key, prevented } = setup({ index: 2, column: 0 });
    key('Enter');
    key(' ');
    expect(log).toEqual(['play Gamma', 'toggle Gamma Jazz']);
    expect(prevented()).toBe(2);
  });

  it('到头的移动键也拦下缺省，不让外层滚', () => {
    const { log, key, prevented } = setup({ index: 2, column: 0 });
    key('ArrowDown');
    expect(log).toEqual([]);
    expect(prevented()).toBe(1);
  });

  it('打字即跳只移焦点、不改修饰；串里的空格照样归它', () => {
    const { log, key } = setup({ index: 1, column: 0 });
    key('g');
    key(' ');
    expect(log).toEqual(['focus -Gamma', 'scroll 2']);
  });

  it('打字即跳命中节头：滚到节头，焦点落在它下面第一块，之后的按键照常', () => {
    const { log, key } = setup();
    key('j');
    key('ArrowRight');
    key('Enter');
    expect(log).toEqual(['focus -Alpha', 'scroll 0', 'focus -Beta', 'scroll 1', 'play Beta']);
  });

  it('Ctrl+A 全选；带 Ctrl 的字母不当打字', () => {
    const { log, key } = setup({ index: 1, column: 0 });
    key('a', { ctrlKey: true });
    key('b', { ctrlKey: true });
    expect(log).toEqual(['selectAll']);
  });

  it('Shift+F10 按下时、Menu 键松开时在焦点图块下沿开菜单，先落焦点', () => {
    const { input, log, key } = setup({ index: 1, column: 1 });
    key('F10', { shiftKey: true });
    input.keyup({ key: 'ContextMenu', preventDefault: () => {} });
    expect(log).toEqual(['focus Beta', 'menu Beta 10,20', 'focus Beta', 'menu Beta 10,20']);
  });

  it('带 Alt 的键一律不接，留给后退与前进；Shift+Alt+F10 也不开菜单', () => {
    const { log, key, prevented } = setup({ index: 1, column: 0 });
    key('ArrowLeft', { altKey: true });
    key('ArrowRight', { altKey: true });
    key('g', { altKey: true });
    key('F10', { altKey: true, shiftKey: true });
    expect(log).toEqual([]);
    expect(prevented()).toBe(0);
  });

  it('Esc 不归网格', () => {
    const { log, key, prevented } = setup({ index: 1, column: 0 });
    key('g');
    key('Escape');
    expect(log).toEqual(['focus -Gamma', 'scroll 2']);
    expect(prevented()).toBe(1);
  });

  it('Shift + 滚轮缩放，上滚放大；不带 Shift 照常滚', () => {
    const { input, log } = setup();
    let prevented = 0;
    const wheel = (deltaY: number, shiftKey: boolean) =>
      input.wheel({ deltaY, shiftKey, preventDefault: () => (prevented += 1) });
    wheel(-100, true);
    wheel(100, true);
    wheel(100, false);
    expect(log).toEqual(['zoom 1', 'zoom -1']);
    expect(prevented).toBe(2);
  });
});
