import { describe, expect, it } from 'vitest';
import {
  INITIAL_SELECTION_SWAP,
  RAPID_SWAP_MS,
  advanceSelectionSwap,
  selectionSwapSource,
  type SelectionSwapState,
} from '../../../../src/immersive/track-info/useSelectionSwap.ts';
import type { TrackSwap } from '../../../../src/playback/now-playing/trackSwap.ts';

const swap = (
  serial: number,
  direction: TrackSwap['direction'] = 'next',
  kind: TrackSwap['kind'] = 'track',
): TrackSwap => ({ serial, kind, direction, sameCover: false, at: 0 });

const at = (key: string, index: number, browsing: boolean) => ({ key, index, browsing });

/** 依次喂选中项（换曲序号取各自的），答最后的状态 */
function feed(
  steps: readonly (readonly [ReturnType<typeof at> | null, number])[],
  from: SelectionSwapState = INITIAL_SELECTION_SWAP,
): SelectionSwapState {
  return steps.reduce(
    (state, [selection, serial]) => advanceSelectionSwap(state, selection, serial),
    from,
  );
}

describe('不在 Coverflow 里：送给换字的就是换曲记录', () => {
  it('序号、种类、方向都照换曲记录，换曲序号涨多少它涨多少', () => {
    let state = feed([[null, 5]]);
    expect(selectionSwapSource(state, swap(5, 'previous'))).toEqual({
      serial: 5,
      kind: 'track',
      direction: 'previous',
      rapidMs: RAPID_SWAP_MS,
    });
    state = feed([[null, 6]], state);
    expect(selectionSwapSource(state, swap(6)).serial).toBe(6);
  });
});

describe('进入 Coverflow', () => {
  it('刚开始跟踪选中项不算换，序号不变', () => {
    const state = feed([[at('current:a', 3, false), 5]]);
    expect(state.bumps).toBe(0);
    expect(selectionSwapSource(state, swap(5)).serial).toBe(5);
  });
});

describe('浏览换选中项', () => {
  const browsingB = feed([
    [at('current:a', 3, false), 5],
    [at('queued:b', 4, true), 5],
  ]);

  it('键变了序号加一，往后翻是 next，换曲序号没变时用这里的方向', () => {
    expect(browsingB.bumps).toBe(1);
    expect(selectionSwapSource(browsingB, swap(5, 'none'))).toEqual({
      serial: 6,
      kind: 'track',
      direction: 'next',
      rapidMs: RAPID_SWAP_MS,
    });
  });

  it('连续换选中项时不放过渡的间隔下限是进场的 250 ms', () => {
    expect(RAPID_SWAP_MS).toBe(250);
  });

  it('往前翻是 previous，位置没变（键换了）是 none', () => {
    const back = feed([[at('played:z', 2, true), 5]], browsingB);
    expect(selectionSwapSource(back, swap(5, 'next')).direction).toBe('previous');
    const same = feed([[at('queued:c', 4, true), 5]], browsingB);
    expect(selectionSwapSource(same, swap(5, 'next')).direction).toBe('none');
  });

  it('同一个键不算换，序号不变', () => {
    const again = feed([[at('queued:b', 4, true), 5]], browsingB);
    expect(again).toBe(browsingB);
  });

  it('浏览别的曲目期间换曲记录的变化不跟：字写的不是正在播放那首，不重放', () => {
    const later = feed([[at('queued:b', 4, true), 6]], browsingB);
    expect(selectionSwapSource(later, swap(6)).serial).toBe(6);
    expect(later.bumps).toBe(1);
  });

  it('回到正在播放：序号补上换曲序号的变化，只涨一次，方向按位置', () => {
    const during = feed([[at('queued:b', 4, true), 7]], browsingB);
    const before = selectionSwapSource(during, swap(7)).serial;
    const home = feed([[at('current:c', 3, false), 7]], during);
    const source = selectionSwapSource(home, swap(7, 'next'));
    expect(source.serial).toBeGreaterThan(before);
    expect(source.direction).toBe('previous');
  });

  it('序号只增不减：连着换几次一路往上', () => {
    let state = feed([[at('current:a', 3, false), 5]]);
    let last = selectionSwapSource(state, swap(5)).serial;
    for (const [key, index, browsing] of [
      ['queued:b', 4, true],
      ['queued:c', 5, true],
      ['queued:b', 4, true],
      ['current:a', 3, false],
    ] as const) {
      state = feed([[at(key, index, browsing), 5]], state);
      const serial = selectionSwapSource(state, swap(5)).serial;
      expect(serial).toBeGreaterThan(last);
      last = serial;
    }
  });
});

describe('Coverflow 里自然接下一首（换曲记录与选中项同时变）', () => {
  it('只放一次，方向取换曲记录的', () => {
    const before = feed([[at('current:a', 3, false), 5]]);
    // 同一个位置，键从 current:a 换成 current:b，换曲序号 5 → 6
    const after = feed([[at('current:b', 3, false), 6]], before);
    const source = selectionSwapSource(after, swap(6, 'next'));
    expect(source.direction).toBe('next');
    expect(source.serial).toBeGreaterThan(5);
  });
});

describe('退出 Coverflow', () => {
  it('序号不回退，停止跟踪后又跟着换曲记录走', () => {
    const browsing = feed([
      [at('current:a', 3, false), 5],
      [at('queued:b', 4, true), 5],
    ]);
    const before = selectionSwapSource(browsing, swap(5)).serial;
    const left = feed([[null, 5]], browsing);
    expect(selectionSwapSource(left, swap(5)).serial).toBeGreaterThanOrEqual(before);
    const next = feed([[null, 6]], left);
    expect(selectionSwapSource(next, swap(6)).serial).toBe(
      selectionSwapSource(left, swap(5)).serial + 1,
    );
  });

  it('再次进入不算换', () => {
    const left = feed([
      [at('current:a', 3, false), 5],
      [null, 5],
    ]);
    const back = feed([[at('current:a', 3, false), 5]], left);
    expect(back.bumps).toBe(left.bumps);
  });
});
