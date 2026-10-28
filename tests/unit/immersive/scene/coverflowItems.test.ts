import { describe, expect, it } from 'vitest';
import {
  coverflowItems,
  currentIndexOf,
  currentKeyOf,
  selectedIndexOf,
  type CoverflowSources,
} from '../../../../src/immersive/scene/coverflowItems.ts';
import type { QueueEntry } from '../../../../src/playback/queue/queueState.ts';
import type { UpNextRow } from '../../../../src/playback/queue/upNextModel.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

const track = (name: string) => makeTrack({ path: `file://E:/Music/${name}.flac`, title: name });
const played = (name: string) => ({ key: `r-${name}`, track: track(name) });
const queued = (name: string): QueueEntry => ({ key: `${name}#0`, track: track(name), spot: null });
const upNextRow = (name: string, offset: number): UpNextRow => ({
  key: `u-${name}`,
  row: 10 + offset,
  offset,
  track: track(name),
});

function sources(patch: Partial<CoverflowSources> = {}): CoverflowSources {
  return {
    review: [],
    earlier: { list: null, rows: [], total: 0 },
    current: track('now'),
    queue: [],
    upNext: { list: null, rows: [] },
    ...patch,
  };
}

const LIST = { guid: 'guid-1', index: 0, name: 'main' };

describe('coverflowItems：条目表的拼接', () => {
  it('按已播、正在播放、队列、接下来排，键带段名', () => {
    const items = coverflowItems(
      sources({
        review: [played('a'), played('b')],
        queue: [queued('q1')],
        upNext: { list: LIST, rows: [upNextRow('u0', 0), upNextRow('u1', 1)] },
      }),
    );
    expect(items.map((item) => item.kind)).toEqual([
      'played',
      'played',
      'current',
      'queued',
      'upNext',
      'upNext',
    ]);
    expect(items.map((item) => item.key)).toEqual([
      'played:r-a',
      'played:r-b',
      currentKeyOf(track('now')),
      'queued:q1#0',
      'list:u-u0',
      'list:u-u1',
    ]);
  });

  it('没有当前曲目时正在播放那一条仍在，曲目是 null', () => {
    const items = coverflowItems(sources({ current: null, queue: [queued('q1')] }));
    expect(items.map((item) => item.kind)).toEqual(['current', 'queued']);
    expect(items[0]?.track).toBeNull();
    expect(items[0]?.key).toBe('current:');
  });

  it('0 首、只有已播、只有接下来都拼得出', () => {
    expect(coverflowItems(sources())).toHaveLength(1);
    const onlyPlayed = coverflowItems(sources({ review: [played('a')] }));
    expect(onlyPlayed.map((item) => item.kind)).toEqual(['played', 'current']);
    const onlyNext = coverflowItems(
      sources({ upNext: { list: LIST, rows: [upNextRow('u0', 0)] } }),
    );
    expect(onlyNext.map((item) => item.kind)).toEqual(['current', 'upNext']);
  });

  it('接下来带来源列表与行号，队列条目带行的身份', () => {
    const items = coverflowItems(
      sources({ queue: [queued('q1')], upNext: { list: LIST, rows: [upNextRow('u0', 0)] } }),
    );
    expect(items[1]).toMatchObject({ kind: 'queued', entry: 'q1#0' });
    expect(items[2]).toMatchObject({ kind: 'upNext', guid: 'guid-1', row: 10 });
  });

  it('接下来只取从第 0 行起连续的缓存行，缓存里只剩后面几页时不接在队列后面', () => {
    const gap = coverflowItems(
      sources({
        upNext: { list: LIST, rows: [upNextRow('u0', 0), upNextRow('u1', 1), upNextRow('u5', 5)] },
      }),
    );
    expect(gap.filter((item) => item.kind === 'upNext')).toHaveLength(2);
    const laterPagesOnly = coverflowItems(
      sources({ upNext: { list: LIST, rows: [upNextRow('u200', 200)] } }),
    );
    expect(laterPagesOnly.some((item) => item.kind === 'upNext')).toBe(false);
  });

  it('缓存行的数组顺序不影响连续性判断', () => {
    const items = coverflowItems(
      sources({ upNext: { list: LIST, rows: [upNextRow('u1', 1), upNextRow('u0', 0)] } }),
    );
    expect(items.filter((item) => item.kind === 'upNext').map((item) => item.key)).toEqual([
      'list:u-u0',
      'list:u-u1',
    ]);
  });

  it('没有来源列表时接下来不出，即使缓存里还留着行', () => {
    const items = coverflowItems(sources({ upNext: { list: null, rows: [upNextRow('u0', 0)] } }));
    expect(items).toHaveLength(1);
  });

  it('同一首排在已播与队列里，两条的键不撞', () => {
    const items = coverflowItems(
      sources({ review: [{ key: 'x', track: track('a') }], queue: [queued('a')] }),
    );
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });
});

describe('coverflowItems：左边跟正在播放的列表顺序', () => {
  // 来源列表里正在播放的是第 5 行，前面是第 0 到 4 行；偏移从 0 起，最近的一行偏移最大
  const earlierRow = (name: string, offset: number): UpNextRow => ({
    key: `e-${name}`,
    row: offset,
    offset,
    track: track(name),
  });
  const rows = [0, 1, 2, 3, 4].map((offset) => earlierRow(`e${offset}`, offset));
  // 正在播放的是列表里的一行时，它的键由列表、前面有几首和曲目句柄拼成，与它做「接下来」时的行键同一种
  const listCurrent = (total: number) => `list:guid-1:${total}:${track('now').handle}`;

  it('有之前的曲目时左边按列表顺序排，紧接着当前曲目，播放记录不出', () => {
    const items = coverflowItems(
      sources({
        review: [played('a')],
        earlier: { list: LIST, rows, total: 5 },
        queue: [queued('q1')],
      }),
    );
    expect(items.map((item) => item.key)).toEqual([
      'list:e-e0',
      'list:e-e1',
      'list:e-e2',
      'list:e-e3',
      'list:e-e4',
      listCurrent(5),
      'queued:q1#0',
    ]);
    expect(items[0]).toMatchObject({ kind: 'earlier', guid: 'guid-1', row: 0 });
    expect(items[4]).toMatchObject({ kind: 'earlier', guid: 'guid-1', row: 4 });
  });

  it('只取紧挨着当前曲目、连续缓存的那一段：中间缺行就停', () => {
    const items = coverflowItems(
      sources({
        earlier: { list: LIST, rows: [rows[0]!, rows[1]!, rows[3]!, rows[4]!], total: 5 },
      }),
    );
    expect(items.map((item) => item.key)).toEqual(['list:e-e3', 'list:e-e4', listCurrent(5)]);
  });

  it('还没读到任何一行时左边先空着，不拿播放记录凑', () => {
    const items = coverflowItems(
      sources({ review: [played('a')], earlier: { list: LIST, rows: [], total: 5 } }),
    );
    expect(items.map((item) => item.kind)).toEqual(['current']);
  });

  it('起播列表里靠后的一首：它与被跳过的几首换了段，键不变，引擎认得是同一批卡', () => {
    // 起播前：正在播放第 5 行（a），接下来是第 6 到 9 行；点第 9 行（f）起播
    const row = (name: string, at: number): UpNextRow => ({
      key: `guid-1:${at}:${track(name).handle}`,
      row: at,
      offset: at,
      track: track(name),
    });
    const before = coverflowItems(
      sources({
        current: track('a'),
        earlier: { list: LIST, rows: [row('e', 4)], total: 5 },
        upNext: {
          list: LIST,
          rows: [row('b', 6), row('c', 7), row('d', 8), row('f', 9)].map((item, offset) => ({
            ...item,
            offset,
          })),
        },
      }),
    );
    const after = coverflowItems(
      sources({
        current: track('f'),
        earlier: {
          list: LIST,
          rows: [row('e', 4), row('a', 5), row('b', 6), row('c', 7), row('d', 8)],
          total: 9,
        },
        upNext: { list: LIST, rows: [] },
      }),
    );
    // 前面几首换了段（接下来 → 之前的曲目）、f 从接下来变成正在播放，键都不变
    const keyOf = (items: typeof before, name: string) =>
      items.find((item) => item.track?.handle === track(name).handle)?.key;
    for (const name of ['b', 'c', 'd', 'f']) {
      expect(keyOf(after, name)).toBe(keyOf(before, name));
    }
    expect(keyOf(after, 'f')).toBe(`list:guid-1:9:${track('f').handle}`);
    expect(after.find((item) => item.kind === 'current')?.track?.handle).toBe(track('f').handle);
  });

  it('没有列表顺序可跟时（没有来源列表或之前没有曲目）左边用播放记录', () => {
    const noList = coverflowItems(
      sources({ review: [played('a')], earlier: { list: null, rows, total: 5 } }),
    );
    expect(noList.map((item) => item.kind)).toEqual(['played', 'current']);
    const first = coverflowItems(
      sources({ review: [played('a')], earlier: { list: LIST, rows: [], total: 0 } }),
    );
    expect(first.map((item) => item.kind)).toEqual(['played', 'current']);
  });
});

describe('选中项的解析', () => {
  const items = coverflowItems(
    sources({ review: [played('a'), played('b')], queue: [queued('q1'), queued('q2')] }),
  );

  it('正在播放那一条的位置', () => {
    expect(currentIndexOf(items)).toBe(2);
  });

  it('没选时选中正在播放那一条', () => {
    expect(selectedIndexOf(items, null)).toBe(2);
  });

  it('选了某个条目键就是它的位置', () => {
    expect(selectedIndexOf(items, 'played:r-a')).toBe(0);
    expect(selectedIndexOf(items, 'queued:q2#0')).toBe(4);
  });

  it('键对不上任何条目（队列在别处变了）按没选处理，不报错', () => {
    expect(selectedIndexOf(items, 'queued:gone#0')).toBe(2);
  });
});
