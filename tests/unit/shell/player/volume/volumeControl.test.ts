import { describe, expect, it, vi } from 'vitest';
import {
  createVolumeSender,
  stepBase,
  steppedPosition,
  VOLUME_MEMORY_MS,
  volumeLevel,
} from '../../../../../src/shell/player/volume/volumeControl.ts';
import { dbOf, positionOf } from '../../../../../src/playback/volumeScale.ts';

describe('volumeLevel', () => {
  it('静音或到底是静音档，其余按三等分', () => {
    expect(volumeLevel(80, true)).toBe('muted');
    expect(volumeLevel(0, false)).toBe('muted');
    expect(volumeLevel(20, false)).toBe('low');
    expect(volumeLevel(50, false)).toBe('mid');
    expect(volumeLevel(90, false)).toBe('high');
  });
});

describe('steppedPosition', () => {
  it('一步一个位置单位，按步数挪，夹在 0–100', () => {
    expect(steppedPosition(50, 1)).toBe(51);
    expect(steppedPosition(50, -1)).toBe(49);
    expect(steppedPosition(50, 3)).toBe(53);
    expect(steppedPosition(99.5, 1)).toBe(100);
    expect(steppedPosition(0.5, -1)).toBe(0);
    expect(steppedPosition(50, 0)).toBe(50);
  });

  it('按刻度换回 dB 再换回来，一步还是一个位置单位', () => {
    for (const scale of ['perceptual', 'db'] as const) {
      const start = positionOf(-20, scale);
      const next = steppedPosition(start, 1);
      expect(positionOf(dbOf(next, scale), scale)).toBeCloseTo(start + 1, 6);
    }
  });
});

describe('stepBase', () => {
  it('连着滚时从最近发出的音量起挪，宿主的事件还没追上也不丢步', () => {
    let now = 0;
    const sender = createVolumeSender({ setVolume: () => new Promise<void>(() => {}) }, () => now);
    expect(stepBase(sender, -30)).toBe(-30);
    sender.live(-25);
    now += 100;
    expect(stepBase(sender, -30)).toBe(-25);
    now += VOLUME_MEMORY_MS;
    expect(stepBase(sender, -30)).toBe(-30);
  });
});

describe('createVolumeSender', () => {
  it('实时提交与松手提交直接交给服务，不在控件内另排队', () => {
    const setVolume = vi.fn(() => new Promise<void>(() => {}));
    const sender = createVolumeSender({ setVolume });
    sender.live(-30);
    sender.live(-20);
    sender.commit(-18);
    expect(setVolume.mock.calls).toEqual([
      [-30, false],
      [-20, false],
      [-18, true],
    ]);
  });

  it('最近发出的音量在记忆时限内当作下一步的起点，过了就不算', () => {
    let now = 1000;
    const sender = createVolumeSender({ setVolume: async () => {} }, () => now);
    expect(sender.recent()).toBeNull();
    sender.live(-12);
    now += VOLUME_MEMORY_MS;
    expect(sender.recent()).toBe(-12);
    now += 1;
    expect(sender.recent()).toBeNull();
  });
});
