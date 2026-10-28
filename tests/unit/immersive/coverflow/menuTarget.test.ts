import { describe, expect, it, vi } from 'vitest';
import { menuTargetOf } from '../../../../src/immersive/coverflow/menuTarget.ts';
import type { CoverflowItem } from '../../../../src/immersive/scene/coverflowItems.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

const track = makeTrack({ path: 'file://E:/Music/a.flac' });
const at = { x: 10, y: 20 };

const items: CoverflowItem[] = [
  { key: 'played:r1', kind: 'played', track },
  { key: 'played:r2', kind: 'played', track },
  { key: 'list:cur', kind: 'current', track },
  { key: 'queued:h#0', kind: 'queued', track, entry: 'h#0' },
  { key: 'queued:h#1', kind: 'queued', track, entry: 'h#1' },
  { key: 'list:n', kind: 'upNext', track, guid: 'g', row: 7 },
];

const itemAt = (index: number, list = items): CoverflowItem => {
  const item = list[index];
  if (!item) throw new Error('没有这个条目');
  return item;
};
const target = (index: number, list = items) =>
  menuTargetOf(itemAt(index, list), list, at, () => {});

describe('menuTargetOf：封面上的右键菜单对应队列菜单的哪一段', () => {
  it('「队列」段的行用队列条目的身份当键，序号按它在队列里的位置', () => {
    const second = target(4);
    expect(second?.itemKey).toBe('queued:h#1');
    expect(second?.menu.anchor).toMatchObject({ key: 'h#1', kind: 'queued', number: 2, row: null });
  });

  it('已播对应回看段，序号按它在已播里的位置', () => {
    expect(target(1)?.menu.anchor).toMatchObject({ key: 'played:r2', kind: 'review', number: 2 });
  });

  it('接下来的行带来源列表的行号', () => {
    expect(target(5)?.menu.anchor).toMatchObject({ kind: 'upnext', number: 8, row: 7 });
  });

  it('之前的曲目与接下来同样带行号，段名不同', () => {
    const earlier: CoverflowItem = { key: 'list:e', kind: 'earlier', track, guid: 'g', row: 3 };
    expect(menuTargetOf(earlier, [earlier], at, () => {})?.menu.anchor).toMatchObject({
      kind: 'earlier',
      number: 4,
      row: 3,
    });
  });

  it('正在播放的有曲目时可开菜单，没有曲目（停止）时没有菜单', () => {
    expect(target(2)?.menu.anchor).toMatchObject({
      kind: 'current',
      key: `current:${track.handle}`,
    });
    const idle: CoverflowItem[] = [{ key: 'current:', kind: 'current', track: null }];
    expect(target(0, idle)).toBeNull();
  });

  it('落点与起播回调原样交给菜单，菜单只作用于点中的这一行', () => {
    const play = vi.fn();
    const result = menuTargetOf(itemAt(3), items, at, play);
    expect(result?.menu.at).toBe(at);
    expect(result?.menu.rows).toEqual([result?.menu.anchor]);
    result?.menu.play?.();
    expect(play).toHaveBeenCalledOnce();
  });
});
