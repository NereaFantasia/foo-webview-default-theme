import type { MenuCommand } from 'foo-webview-sdk';
import { expect, it, vi } from 'vitest';
import { contextMenuEntries } from '../../../src/host/contextMenuEntries.ts';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';

it('保留同名不同身份的宿主命令，不可执行项仍禁用', () => {
  const node: MenuCommand = {
    type: 'command',
    commandId: 1,
    guid: '{A}',
    label: 'Properties',
    displayLabel: '属性',
    path: 'Properties',
    displayPath: '属性',
    available: true,
  };
  const run = vi.fn();
  const items = contextMenuEntries(
    [node, { ...node, guid: '{B}', commandId: 2, available: false }],
    run,
  );
  expect(items).toHaveLength(2);
  expect(items[1]).toMatchObject({ disabled: true });
  const first = items[0];
  if (first.kind !== 'command') throw new Error('应为命令');
  first.onSelect();
  expect(run).toHaveBeenCalledWith(node);
});

it('只禁用已接管的叶子，同族其他子项、同名第三方命令和仅有编号的命令仍可执行', () => {
  const node: MenuCommand = {
    type: 'command',
    commandId: 1,
    guid: '{A}',
    subGuid: '{ONE}',
    label: '评分',
    displayLabel: '评分',
    path: '评分',
    displayPath: '评分',
    available: true,
    enabled: true,
  };
  const run = vi.fn();
  const entries = contextMenuEntries(
    [
      {
        type: 'submenu',
        label: '统计',
        displayLabel: '统计',
        path: '统计',
        displayPath: '统计',
        children: [
          node,
          { ...node, commandId: 2, subGuid: '{TWO}' },
          { ...node, commandId: 3, guid: '{B}' },
          { ...node, commandId: 4, guid: undefined, subGuid: undefined, executable: false },
          { ...node, commandId: 5, guid: '{C}', enabled: false },
        ],
      },
    ],
    run,
    [{ command: node, label: '评分' }],
  );
  const group = entries[0];
  if (group.kind !== 'submenu') throw new Error('应保留分组');
  expect(group.disabled).not.toBe(true);
  expect(group.items.map((entry) => entry.kind === 'command' && entry.disabled)).toEqual([
    true,
    false,
    false,
    false,
    true,
  ]);
  const item = group.items[3];
  if (item.kind !== 'command') throw new Error('应保留无 GUID 的命令');
  item.onSelect();
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ commandId: 4 }));
});

it('区分被接管、宿主不可用和缺少编号，不把其他功能一起禁用', () => {
  const node: MenuCommand = {
    type: 'command',
    commandId: 1,
    label: 'Properties',
    displayLabel: '属性',
    path: 'Properties',
    displayPath: '属性',
    available: true,
  };
  const entries = contextMenuEntries(
    [
      node,
      { ...node, commandId: 2, available: false },
      { ...node, commandId: undefined },
      { ...node, commandId: 3 },
    ],
    vi.fn(),
    [{ command: node, label: '属性' }],
    'host',
    createTranslate(zhCN, {}),
  );
  expect(entries.map((entry) => entry.kind === 'command' && entry.reason)).toEqual([
    '请使用「属性」',
    'foobar2000 当前无法执行此命令',
    '此处无法执行该命令',
    undefined,
  ]);
});
