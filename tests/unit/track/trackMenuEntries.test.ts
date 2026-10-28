import type { MenuCommand } from 'foo-webview-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { RatingCommands } from '../../../src/host/contextMenu.ts';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import type {
  ContextMenuCommand,
  ContextMenuEntry,
} from '../../../src/kit/context-menu/contextMenuItems.ts';
import {
  divider,
  hostRatingEntry,
  trackMenuEntries,
  type GoToTarget,
  type TrackActionContext,
} from '../../../src/track/trackMenuEntries.ts';

const t = createTranslate(zhCN, {});

function context(change: Partial<TrackActionContext> = {}): TrackActionContext {
  return {
    t,
    usable: true,
    multiple: false,
    targets: [],
    handlers: {
      play: vi.fn(),
      next: vi.fn(),
      enqueue: vi.fn(),
      sendToNew: vi.fn(),
      sendTo: vi.fn(),
    },
    goTo: null,
    rating: null,
    properties: null,
    more: [],
    ...change,
  };
}

function command(entries: readonly ContextMenuEntry[], id: string): ContextMenuCommand {
  const entry = entries.find((item) => item.id === id);
  if (entry?.kind !== 'command') throw new Error(`缺少命令 ${id}`);
  return entry;
}

function leaf(label: string, commandId: number, checked = false): MenuCommand {
  return {
    type: 'command',
    label,
    displayLabel: label,
    path: label,
    displayPath: label,
    available: true,
    commandId,
    radioChecked: checked,
  };
}

describe('标准项', () => {
  it('按 id 展开，页面的条目与分隔线原样夹在其间', () => {
    const own = { kind: 'command' as const, id: 'own', label: '本页', onSelect: vi.fn() };
    const entries = trackMenuEntries(
      ['play', own, 'play-next', 'enqueue', divider('send-divider'), 'send-to'],
      context(),
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      'play',
      'own',
      'play-next',
      'enqueue',
      'send-divider',
      'send-to',
    ]);
    expect(command(entries, 'play').label).toBe('播放');
    expect(command(trackMenuEntries(['play'], context({ multiple: true })), 'play').label).toBe(
      '播放所选',
    );
  });

  it('作用对象不可用时播放、入队与发送置灰；改写只动文字与可用性，执行不变', () => {
    const blocked = trackMenuEntries(['play', 'enqueue', 'send-to'], context({ usable: false }));
    expect(
      blocked.map((entry) => entry.kind !== 'separator' && 'disabled' in entry && entry.disabled),
    ).toEqual([true, true, true]);
    const env = context();
    const [patched] = trackMenuEntries(
      [{ action: 'play-next', label: '改过', reason: '说明' }],
      env,
    );
    expect(patched).toMatchObject({ id: 'play-next', label: '改过', reason: '说明' });
    if (patched?.kind !== 'command') throw new Error('缺少命令');
    patched.onSelect();
    expect(env.handlers.next).toHaveBeenCalledTimes(1);
  });

  it('发送到：先新建，再列目标；锁着的置灰并说明，点了交回那一张', () => {
    const open = { guid: '{a}', name: 'Open', locked: false };
    const locked = { guid: '{b}', name: 'Locked', locked: true };
    const env = context({ targets: [open, locked] });
    const [branch] = trackMenuEntries(['send-to'], env);
    if (branch?.kind !== 'submenu') throw new Error('缺少发送到');
    expect(branch.items.map((entry) => entry.id)).toEqual([
      'send-to-new',
      'targets-divider',
      'send:{a}',
      'send:{b}',
    ]);
    expect(command(branch.items, 'send:{b}')).toMatchObject({ disabled: true, reason: '锁定' });
    command(branch.items, 'send:{a}').onSelect();
    command(branch.items, 'send-to-new').onSelect();
    expect(env.handlers.sendTo).toHaveBeenCalledWith(open);
    expect(env.handlers.sendToNew).toHaveBeenCalledTimes(1);
  });

  it('转到专辑在当前专辑省略，找不到目标时解释原因，多选时说明采用落点', () => {
    const open = vi.fn();
    const goTo = (album: GoToTarget | null) => ({ album, artists: [] });
    const album = (change: Partial<GoToTarget>): GoToTarget => ({
      name: 'A',
      open,
      here: false,
      ...change,
    });
    expect(
      trackMenuEntries(['go-to-album'], context({ goTo: goTo(album({ here: true })) })),
    ).toEqual([]);
    expect(trackMenuEntries(['go-to-album'], context())).toEqual([]);
    const missing = trackMenuEntries(
      ['go-to-album'],
      context({ goTo: goTo(album({ open: null })) }),
    );
    expect(command(missing, 'go-to-album')).toMatchObject({
      disabled: true,
      reason: '媒体库中没有对应的专辑',
    });
    const entries = trackMenuEntries(
      ['go-to-album'],
      context({ goTo: goTo(album({})), multiple: true }),
    );
    const entry = command(entries, 'go-to-album');
    expect(entry).toMatchObject({ disabled: false, label: '转到专辑' });
    expect(entry).toHaveProperty('detail', t('trackMenu.clickedTrack'));
    entry.onSelect();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('转到艺人：一位是单项，已在他的页面上不出；没有艺人不出', () => {
    const open = vi.fn();
    const one = (here: boolean) => ({
      album: null,
      artists: [{ name: 'Nujabes', open, here }],
    });
    expect(trackMenuEntries(['go-to-artist'], context())).toEqual([]);
    expect(trackMenuEntries(['go-to-artist'], context({ goTo: one(true) }))).toEqual([]);
    const entry = command(
      trackMenuEntries(['go-to-artist'], context({ goTo: one(false) })),
      'go-to-artist',
    );
    expect(entry).toMatchObject({ disabled: false, label: '转到艺人' });
    entry.onSelect();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('转到艺人：两位起收成子菜单，按顺序列出，打不开的置灰并说明，所在的那位标「当前」', () => {
    const open = vi.fn();
    const [branch] = trackMenuEntries(
      ['go-to-artist'],
      context({
        goTo: {
          album: null,
          artists: [
            { name: 'A', open, here: true },
            { name: 'B', open: null, here: false },
            { name: 'C', open, here: false },
          ],
        },
      }),
    );
    if (branch?.kind !== 'submenu') throw new Error('缺少转到艺人子菜单');
    expect(branch.label).toBe('转到艺人');
    expect(branch.items.map((item) => item.kind !== 'separator' && item.label)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(command(branch.items, 'go-to-artist:0')).toMatchObject({ badge: '当前' });
    expect(command(branch.items, 'go-to-artist:1')).toMatchObject({
      disabled: true,
      reason: '没有艺人页',
    });
    command(branch.items, 'go-to-artist:2').onSelect();
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('属性认不出时置灰；更多命令为空不出，评分没给不出', () => {
    const entries = trackMenuEntries(['rating', 'properties', 'more-commands'], context());
    expect(entries.map((entry) => entry.id)).toEqual(['properties']);
    expect(command(entries, 'properties').disabled).toBe(true);
    const properties = vi.fn();
    const more = [{ kind: 'status' as const, id: 'host-loading', label: '读取中' }];
    const full = trackMenuEntries(['properties', 'more-commands'], context({ properties, more }));
    expect(full.map((entry) => entry.id)).toEqual(['properties', 'more-commands']);
    command(full, 'properties').onSelect();
    expect(properties).toHaveBeenCalledTimes(1);
  });
});

describe('按宿主树评分', () => {
  it('勾宿主此刻的那一档，点一档交回树里对应的命令与值，清除是 0', () => {
    const values = [1, 2, 3, 4, 5].map((value) => ({
      value,
      node: leaf(String(value), value, value === 3),
    }));
    const clear = leaf('<not set>', 9);
    const rating: RatingCommands = { values, clear, current: 3 };
    const rate = vi.fn();
    const branch = hostRatingEntry(t, rating, rate);
    expect(branch.disabled).toBe(false);
    expect(command(branch.items, 'rating:3').checked).toBe(true);
    command(branch.items, 'rating:5').onSelect();
    command(branch.items, 'rating:0').onSelect();
    expect(rate.mock.calls).toEqual([
      [values[4]!.node, 5],
      [clear, 0],
    ]);
  });

  it('认不出评分子菜单时整项置灰', () => {
    const branch = hostRatingEntry(t, null, vi.fn());
    expect(branch.disabled).toBe(true);
    expect(command(branch.items, 'rating:0').disabled).toBe(true);
  });
});
