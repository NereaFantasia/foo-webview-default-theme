import { describe, expect, it } from 'vitest';
import { DURATION_MS } from '../../../../../src/motion/timing.ts';
import {
  COVER_LATE_MS,
  coverMotion,
  coverTurnOf,
  TEXT_RISE_PX,
  TEXT_SLIDE_PX,
  textSwapMotion,
} from '../../../../../src/shell/player/now-playing/swapMotion.ts';
import type { TrackSwap } from '../../../../../src/shell/player/now-playing/trackSwap.ts';

const swap = (patch: Partial<TrackSwap>): TrackSwap => ({
  serial: 1,
  kind: 'track',
  direction: 'next',
  sameCover: false,
  at: 0,
  ...patch,
});

/** 某一段里某个属性的首尾两帧。 */
function ends(tracks: ReturnType<typeof textSwapMotion>['enter'], property: string): unknown[] {
  const track = tracks.find(([frames]) => property in (frames[0] ?? {}));
  return track ? [track[0][0]?.[property], track[0].at(-1)?.[property]] : [];
}

describe('textSwapMotion', () => {
  it('下一首旧字往左退、新字从右边来；上一首反过来', () => {
    const next = textSwapMotion(swap({ direction: 'next' }));
    expect(ends(next.exit, 'translate')).toEqual(['0 0', `${-TEXT_SLIDE_PX}px 0`]);
    expect(ends(next.enter, 'translate')).toEqual([`${TEXT_SLIDE_PX}px 0`, '0 0']);
    const previous = textSwapMotion(swap({ direction: 'previous' }));
    expect(ends(previous.exit, 'translate')).toEqual(['0 0', `${TEXT_SLIDE_PX}px 0`]);
    expect(ends(previous.enter, 'translate')).toEqual([`${-TEXT_SLIDE_PX}px 0`, '0 0']);
    // 退场与淡入 83 ms，进场的位移 250 ms。
    expect(next.exit.map(([, timing]) => timing.duration)).toEqual([83, 83]);
    expect(next.enter.map(([, timing]) => timing.duration)).toEqual([
      DURATION_MS.faster,
      DURATION_MS.normal,
    ]);
  });

  it('认不出方向时只淡出、新字从下面上来；起播停止与电台只淡变', () => {
    const none = textSwapMotion(swap({ direction: 'none' }));
    expect(ends(none.exit, 'translate')).toEqual([]);
    expect(ends(none.enter, 'translate')).toEqual([`0 ${TEXT_RISE_PX}px`, '0 0']);
    for (const kind of ['enter', 'leave', 'refresh'] as const) {
      const fade = textSwapMotion(swap({ kind }));
      expect(ends(fade.exit, 'translate')).toEqual([]);
      expect(ends(fade.enter, 'translate')).toEqual([]);
      expect(ends(fade.enter, 'opacity')).toEqual([0, 1]);
    }
  });
});

describe('coverTurnOf', () => {
  it('用过的换曲、电台、同一张专辑不动；起播停止与晚到的图只淡变；其余按方向', () => {
    expect(coverTurnOf(null, 0)).toBe('still');
    expect(coverTurnOf(swap({ kind: 'refresh' }), 0)).toBe('still');
    expect(coverTurnOf(swap({ sameCover: true }), 0)).toBe('still');
    expect(coverTurnOf(swap({ kind: 'enter' }), 0)).toBe('fade');
    expect(coverTurnOf(swap({ kind: 'leave' }), 0)).toBe('fade');
    expect(coverTurnOf(swap({ at: 0 }), COVER_LATE_MS + 1)).toBe('fade');
    expect(coverTurnOf(swap({ direction: 'previous' }), COVER_LATE_MS)).toBe('previous');
  });
});

describe('coverMotion', () => {
  it('不动时没有过渡；淡变只动新图', () => {
    expect(coverMotion('bar', 'still')).toBeNull();
    expect(coverMotion('round', 'fade')?.outgoing).toEqual([]);
  });

  it('底部通栏推入：下一首新图从右边整张进来，旧图往左移出三分之一', () => {
    const push = coverMotion('bar', 'next');
    expect(push?.incoming[0]?.[0].map((frame) => frame['translate'])).toEqual(['100% 0', '0 0']);
    expect(push?.outgoing[0]?.[0].map((frame) => frame['translate'])).toEqual(['0 0', '-33% 0']);
    expect(coverMotion('bar', 'none')?.incoming[0]?.[0][0]?.['translate']).toBe('0 100%');
  });

  it('正在播放条擦除：下一首从右缘往左、上一首反过来、认不出从上往下，旧图不动', () => {
    expect(coverMotion('lcd', 'next')).toMatchObject({ wipe: 'left', outgoing: [] });
    expect(coverMotion('lcd', 'previous')?.wipe).toBe('right');
    expect(coverMotion('lcd', 'none')?.wipe).toBe('down');
  });

  it('胶囊转入：下一首从 -20° 顺时针转正，上一首逆时针，认不出不转', () => {
    const angle = (turn: 'next' | 'previous' | 'none') =>
      coverMotion('round', turn)?.incoming[0]?.[0][0]?.['rotate'];
    expect(angle('next')).toBe('-20deg');
    expect(angle('previous')).toBe('20deg');
    expect(angle('none')).toBe('0deg');
  });
});
