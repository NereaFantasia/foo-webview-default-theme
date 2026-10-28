import { describe, expect, it } from 'vitest';
import { playPlanOf } from '../../../../src/immersive/coverflow/playPlan.ts';
import type { CoverflowItem } from '../../../../src/immersive/scene/coverflowItems.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

const track = makeTrack({ path: 'file://E:/Music/a.flac' });

describe('playPlanOf：按条目所在的段选起播命令', () => {
  it('已播：按句柄重播', () => {
    const item: CoverflowItem = { key: 'played:r1', kind: 'played', track };
    expect(playPlanOf(item)).toEqual({ kind: 'handle', handle: track.handle });
  });

  it('队列里的行：按行的身份立即播，不按句柄（否则队列里会多排一份）', () => {
    const item: CoverflowItem = { key: 'queued:h#0', kind: 'queued', track, entry: 'h#0' };
    expect(playPlanOf(item)).toEqual({ kind: 'queue', entry: 'h#0' });
  });

  it('接下来的行：从来源列表的这一行往下接着播', () => {
    const item: CoverflowItem = {
      key: 'upNext:k',
      kind: 'upNext',
      track,
      guid: 'guid-1',
      row: 12,
    };
    expect(playPlanOf(item)).toEqual({
      kind: 'from',
      source: 'upNext',
      guid: 'guid-1',
      row: 12,
      handle: track.handle,
    });
  });

  it('之前的曲目：同样从这一行往下接着播，但标明来自「之前的曲目」那一段，起播前看那一段有没有在刷新', () => {
    const item: CoverflowItem = {
      key: 'earlier:k',
      kind: 'earlier',
      track,
      guid: 'guid-1',
      row: 3,
    };
    expect(playPlanOf(item)).toEqual({
      kind: 'from',
      source: 'earlier',
      guid: 'guid-1',
      row: 3,
      handle: track.handle,
    });
  });

  it('正在播放的那一条没有要起播的命令', () => {
    expect(playPlanOf({ key: 'current:x', kind: 'current', track })).toBeNull();
    expect(playPlanOf({ key: 'current:', kind: 'current', track: null })).toBeNull();
  });
});
