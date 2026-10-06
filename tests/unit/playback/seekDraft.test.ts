import { describe, expect, it } from 'vitest';
import {
  clockText,
  keySeek,
  SEEK_IDLE,
  secondsAt,
  settleWith,
  shownSeconds,
  type SeekDraft,
} from '../../../src/playback/seekDraft.ts';

describe('secondsAt', () => {
  it('指针横坐标按轨道换成秒，出了轨道夹在两端', () => {
    expect(secondsAt(150, 100, 200, 240)).toBe(60);
    expect(secondsAt(300, 100, 200, 240)).toBe(240);
    expect(secondsAt(20, 100, 200, 240)).toBe(0);
    expect(secondsAt(400, 100, 200, 240)).toBe(240);
  });

  it('轨道没有宽度或曲长未知时是 0', () => {
    expect(secondsAt(150, 100, 0, 240)).toBe(0);
    expect(secondsAt(150, 100, 200, 0)).toBe(0);
  });
});

describe('拖动中的进度', () => {
  const dragging: SeekDraft = { phase: 'dragging', seconds: 120 };

  it('拖动中显示拖到的位置，宿主每拍报来的进度一概不理', () => {
    let draft: SeekDraft = dragging;
    for (const position of [30, 31, 32]) {
      draft = settleWith(draft, position);
      expect(shownSeconds(draft, position)).toBe(120);
    }
    expect(draft).toBe(dragging);
  });

  it('松手后等宿主报回的位置落到拖到的位置附近才交还', () => {
    let draft: SeekDraft = { phase: 'settling', seconds: 120 };
    draft = settleWith(draft, 33);
    expect(shownSeconds(draft, 33)).toBe(120);
    draft = settleWith(draft, 120.4);
    expect(draft).toBe(SEEK_IDLE);
    expect(shownSeconds(draft, 120.4)).toBe(120.4);
  });

  it('没在拖时照宿主报的显示', () => {
    expect(shownSeconds(SEEK_IDLE, 42)).toBe(42);
    expect(settleWith(SEEK_IDLE, 42)).toBe(SEEK_IDLE);
  });
});

describe('keySeek', () => {
  it('← / → 各 5 秒，夹在曲目之内；别的键不管', () => {
    expect(keySeek('ArrowRight', 60, 240)).toBe(65);
    expect(keySeek('ArrowLeft', 60, 240)).toBe(55);
    expect(keySeek('ArrowLeft', 3, 240)).toBe(0);
    expect(keySeek('ArrowRight', 238, 240)).toBe(240);
    expect(keySeek('ArrowUp', 60, 240)).toBeNull();
  });

  it('Home 回到开头；End 不接，跳到曲尾是下一首键的事', () => {
    expect(keySeek('Home', 60, 240)).toBe(0);
    expect(keySeek('End', 60, 240)).toBeNull();
  });
});

describe('clockText', () => {
  it('分:秒，满一小时带上小时', () => {
    expect(clockText(65.9)).toBe('1:05');
    expect(clockText(0)).toBe('0:00');
    expect(clockText(3725)).toBe('1:02:05');
  });
});
