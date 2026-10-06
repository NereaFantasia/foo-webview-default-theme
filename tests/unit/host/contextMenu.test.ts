import type { MenuCommand, MenuItem, MenuSubmenu } from 'foo-webview-sdk';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONTEXT_TREE,
  knownCommandsOf,
  normalizeLabel,
  ratingValueOf,
  readContextTree,
  runContextCommand,
  type ContextTree,
} from '../../../src/host/contextMenu.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

let nextId = 1;
function command(label: string, extra: Partial<MenuCommand> = {}): MenuCommand {
  const commandId = nextId;
  nextId += 1;
  return {
    type: 'command',
    label,
    displayLabel: label,
    path: label,
    displayPath: label,
    available: true,
    enabled: true,
    commandId,
    ...extra,
  };
}

function submenu(label: string, children: MenuItem[]): MenuSubmenu {
  return { type: 'submenu', label, displayLabel: label, path: label, displayPath: label, children };
}

const RATING_LEAVES = ['1', '2', '3', '4', '5'].map((value) =>
  command(value, { checked: value === '4' }),
);
const CLEAR = command('<not set>');
const PROPERTIES = command('&Properties');
const SEND_TO = command('Send to playlist...');
const TREE: ContextTree = {
  roots: [
    command('Play'),
    submenu('Playback Statistics', [submenu('Rating', [...RATING_LEAVES, CLEAR])]),
    { type: 'separator' },
    PROPERTIES,
    submenu('Utilities', [SEND_TO]),
  ],
  target: { mode: 'handles', handles: ['file://E:\\a.flac'] },
};

function menuAnswer(items: MenuItem[]) {
  return {
    success: true as const,
    mode: 'handles' as const,
    locale: 'en',
    i18n: true,
    withAvailability: true,
    items,
  };
}

describe('readContextTree', () => {
  it('按路径生成时带上 handles 与界面语言，记下生成用的目标', async () => {
    const host = installFakeHost();
    host.answer('menu.getContextMenu', menuAnswer(TREE.roots.slice()));
    const target = { mode: 'handles', handles: ['file://E:\\a.flac|subsong:2'] } as const;
    const tree = await readContextTree(host.fb, target, 'zh-CN');
    expect(host.callsTo('menu.getContextMenu')).toEqual([
      { mode: 'handles', handles: ['file://E:\\a.flac|subsong:2'], locale: 'zh-CN' },
    ]);
    expect(tree.target).toEqual(target);
    expect(tree.roots).toHaveLength(5);
  });

  it('读取失败与正常空树分开', async () => {
    const host = installFakeHost();
    host.answer('menu.getContextMenu', hostFailure('NO_ACTIVE_ITEM'));
    expect(await readContextTree(host.fb, { mode: 'selection' })).toEqual({
      ...EMPTY_CONTEXT_TREE,
      failed: true,
    });
    host.answer('menu.getContextMenu', menuAnswer([]));
    expect(await readContextTree(host.fb, { mode: 'selection' })).toEqual({
      roots: [],
      target: { mode: 'selection' },
    });
  });
});

describe('runContextCommand', () => {
  it('按编号执行，带上生成这棵树时的目标', async () => {
    const host = installFakeHost();
    expect(await runContextCommand(host.fb, TREE, PROPERTIES)).toBe(true);
    expect(host.callsTo('menu.runContextCommandById')).toEqual([
      { id: PROPERTIES.commandId, mode: 'handles', handles: ['file://E:\\a.flac'] },
    ]);
  });

  it('空树、置灰或没有编号的不发；宿主答失败答 false', async () => {
    const host = installFakeHost();
    expect(await runContextCommand(host.fb, EMPTY_CONTEXT_TREE, PROPERTIES)).toBe(false);
    expect(await runContextCommand(host.fb, TREE, command('Off', { enabled: false }))).toBe(false);
    const noId = command('Flat');
    delete noId.commandId;
    expect(await runContextCommand(host.fb, TREE, noId)).toBe(false);
    expect(host.calls).toEqual([]);
    host.answer('menu.runContextCommandById', hostFailure('NOT_FOUND'));
    expect(await runContextCommand(host.fb, TREE, PROPERTIES)).toBe(false);
  });
});

describe('knownCommandsOf', () => {
  it('按原始标签认属性与「发送到播放列表」，去掉助记符与省略号', () => {
    const known = knownCommandsOf(TREE);
    expect(known.properties).toBe(PROPERTIES);
    expect(known.sendToDialog).toBe(SEND_TO);
    expect(normalizeLabel('  &Send To Playlist…')).toBe('send to playlist');
  });

  it('评分子菜单靠 1–5 子项认，勾选照搬宿主', () => {
    const rating = knownCommandsOf(TREE).rating;
    expect(rating?.values.map((entry) => entry.value)).toEqual([1, 2, 3, 4, 5]);
    expect(rating?.clear).toBe(CLEAR);
    expect(rating?.current).toBe(4);
    expect(ratingValueOf(rating ?? null, RATING_LEAVES[1]!)).toBe(2);
    expect(ratingValueOf(rating ?? null, CLEAR)).toBe(0);
    expect(ratingValueOf(rating ?? null, PROPERTIES)).toBeNull();
  });

  it('同一标签匹到几条、或已置灰时当没有', () => {
    const doubled: ContextTree = {
      roots: [command('Properties'), command('属性', { enabled: false }), command('Properties')],
      target: { mode: 'selection' },
    };
    expect(knownCommandsOf(doubled).properties).toBeNull();
    const greyed: ContextTree = {
      roots: [command('属性', { available: false })],
      target: { mode: 'selection' },
    };
    expect(knownCommandsOf(greyed)).toEqual({
      properties: null,
      sendToDialog: null,
      rating: null,
    });
  });
});
