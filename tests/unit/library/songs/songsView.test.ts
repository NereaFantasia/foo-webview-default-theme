import { describe, expect, it } from 'vitest';
import { buildSongsView } from '../../../../src/library/songs/songsView.ts';
import { trackRow } from '../../../fixtures/libraryRows.ts';

const A = trackRow('Donuts', 'Workinonit', { duration: 177 });
const B = trackRow('Mezzanine', 'Angel', { duration: 379 });

describe('歌曲页的条目流', () => {
  it('按宿主的 handle 次序取行，键是 handle、行序号是显示位；对不上的行先空着', () => {
    const view = buildSongsView(
      [B.handle, 'gone', A.handle],
      new Map([A, B].map((t) => [t.handle, t])),
      null,
    );
    expect(view.items.map((item) => [item.key, item.order, item.track?.title])).toEqual([
      [B.handle, 0, 'Angel'],
      ['gone', 1, undefined],
      [A.handle, 2, 'Workinonit'],
    ]);
    expect(view.trackAt(2)).toBe(A);
    expect(view.duration).toBe(556);
  });

  it('给了播放统计时并进行里，空串当没有', () => {
    const stats = new Map([
      [A.handle, { added: '2024-05-01 12:00:00', lastPlayed: '', firstPlayed: '', playCount: 3 }],
    ]);
    const view = buildSongsView(
      [A.handle, B.handle],
      new Map([A, B].map((t) => [t.handle, t])),
      stats,
    );
    expect(view.items[0]?.track).toMatchObject({
      added: '2024-05-01 12:00:00',
      lastPlayed: undefined,
      playCount: 3,
    });
    expect(view.items[1]?.track).toBe(B);
  });
});
