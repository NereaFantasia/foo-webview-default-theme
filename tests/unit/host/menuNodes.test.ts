import type { MenuTreeNode } from 'foo-webview-sdk';
import { describe, expect, it } from 'vitest';
import {
  addressOf,
  hiddenGuidsOf,
  isChecked,
  isEnabled,
  labelOf,
  splitDefaultHidden,
  visibleNodes,
} from '../../../src/host/menuNodes.ts';

const separator: MenuTreeNode = { type: 'separator' };

function command(label: string, extra: Partial<MenuTreeNode> = {}): MenuTreeNode {
  return { type: 'command', label, path: `File/${label}`, guid: `guid-${label}`, ...extra };
}

describe('menuNodes', () => {
  it('标签优先用宿主翻译过的', () => {
    expect(labelOf(command('Open', { displayLabel: '打开' }))).toBe('打开');
    expect(labelOf(command('Open'))).toBe('Open');
  });

  it('只按真值呈现勾选；只有明确答 false 才置灰', () => {
    expect(isChecked(command('A', { checked: false }))).toBe(false);
    expect(isChecked(command('A', { radioChecked: true }))).toBe(true);
    expect(isEnabled(command('A'))).toBe(true);
    expect(isEnabled(command('A', { enabled: false }))).toBe(false);
    expect(isEnabled(command('A', { available: false }))).toBe(false);
  });

  it('执行地址只用 GUID，动态子项带上 subGuid；没有 GUID 或标了不可执行的执行不了', () => {
    expect(addressOf(command('A'))).toEqual({ command: 'guid-A' });
    expect(addressOf(command('A', { subGuid: 'sub' }))).toEqual({
      command: 'guid-A',
      subGuid: 'sub',
    });
    expect(addressOf(command('A', { guid: undefined, commandId: 7 }))).toBeNull();
    expect(addressOf(command('A', { executable: false }))).toBeNull();
    expect(addressOf({ type: 'submenu', label: 'File', children: [] })).toBeNull();
  });

  it('去掉标了不显示的命令，再折叠首尾与连续的分隔符', () => {
    const nodes = [
      separator,
      command('A'),
      separator,
      command('B', { hidden: true }),
      separator,
      command('C'),
      separator,
    ];
    expect(visibleNodes(nodes).map((node) => node.label ?? '|')).toEqual(['A', '|', 'C']);
  });

  it('默认隐藏的命令收进「更多」，保留原来的根；一项不剩的子菜单一并拿掉', () => {
    const tree: MenuTreeNode[] = [
      {
        type: 'submenu',
        label: 'File',
        children: [command('Open'), command('Secret', { guid: 'abc-hidden' })],
      },
      { type: 'submenu', label: 'Debug', children: [command('Dump', { hidden: true })] },
      { type: 'submenu', label: 'Empty', children: [] },
    ];
    const { shown, tucked } = splitDefaultHidden(tree, new Set(['ABC-HIDDEN']));
    expect(shown.map((node) => [node.label, node.children?.map((child) => child.label)])).toEqual([
      ['File', ['Open']],
      ['Empty', []],
    ]);
    expect(tucked.map((node) => [node.label, node.children?.map((child) => child.hidden)])).toEqual(
      [
        ['File', [false]],
        ['Debug', [false]],
      ],
    );
  });

  it('命令枚举里只收标了隐藏的静态槽，统一大写；读不到就是空集', () => {
    const guids = hiddenGuidsOf({
      success: true,
      count: 3,
      expandDynamic: false,
      includeHidden: true,
      dynamicCount: 0,
      commands: [
        entry('a-hidden', true),
        entry('b-shown', false),
        { ...entry('c-dynamic', true), subGuid: 'child' },
      ],
    });
    expect([...guids]).toEqual(['A-HIDDEN']);
    expect(hiddenGuidsOf(null).size).toBe(0);
  });
});

function entry(guid: string, hidden: boolean) {
  return {
    name: guid,
    description: '',
    guid,
    parentGuid: 'parent',
    index: 0,
    path: guid,
    isDynamic: false,
    isDynamicParent: false,
    source: 'mainmenu_static' as const,
    executable: true,
    unaddressableReason: '' as const,
    enabled: true,
    checked: false,
    radioChecked: false,
    hidden,
    stateKnown: true,
    flags: hidden ? 8 : 0,
  };
}
