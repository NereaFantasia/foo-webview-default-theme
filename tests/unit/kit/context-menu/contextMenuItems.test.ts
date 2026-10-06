import { expect, it, vi } from 'vitest';
import {
  contextMenuChecks,
  contextMenuItems,
  type ContextMenuEntry,
} from '../../../../src/kit/context-menu/contextMenuItems.ts';

it('只压缩首尾和连续分隔线，保留未知命令与正常空子菜单', () => {
  const items: ContextMenuEntry[] = [
    { kind: 'separator', id: 'a' },
    { kind: 'submenu', id: 'empty', label: '空', items: [] },
    { kind: 'separator', id: 'b' },
    { kind: 'separator', id: 'c' },
    { kind: 'command', id: 'run', label: '未知', onSelect: vi.fn() },
    { kind: 'separator', id: 'd' },
  ];
  expect(contextMenuItems(items).map((entry) => entry.id)).toEqual(['empty', 'b', 'run']);
  expect(items).toHaveLength(6);
});

it('同层子菜单仍取得自己的勾选值，不将未知评分当成零', () => {
  expect(
    contextMenuChecks([
      {
        kind: 'submenu',
        id: 'rating',
        label: '评分',
        items: [
          {
            kind: 'command',
            id: '3',
            label: '3 星',
            check: 'radio',
            checked: true,
            onSelect: vi.fn(),
          },
          { kind: 'command', id: '0', label: '清除', onSelect: vi.fn() },
        ],
      },
    ]),
  ).toEqual(['3']);
});
