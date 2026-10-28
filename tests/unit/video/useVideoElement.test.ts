import { describe, expect, it } from 'vitest';
import {
  followStalled,
  isStalled,
  type VideoElementStatus,
} from '../../../src/video/useVideoElement.ts';

const HAVE_CURRENT_DATA = 2;
const HAVE_FUTURE_DATA = 3;

describe('视频元素是否卡住', () => {
  it('在走且没有后续数据才算卡住', () => {
    expect(isStalled({ paused: false, readyState: HAVE_CURRENT_DATA })).toBe(true);
    expect(isStalled({ paused: false, readyState: HAVE_FUTURE_DATA })).toBe(false);
  });

  it('暂停着不算卡住：fb2k 暂停与对时跳转期间跟随器都先暂停元素', () => {
    expect(isStalled({ paused: true, readyState: 0 })).toBe(false);
    expect(isStalled({ paused: true, readyState: HAVE_CURRENT_DATA })).toBe(false);
  });
});

describe('缓冲状态的跟随', () => {
  it('已出画面后卡住进入缓冲，数据回来或元素暂停时回到就绪', () => {
    expect(followStalled('ready', true)).toBe('buffering');
    expect(followStalled('buffering', false)).toBe('ready');
    expect(followStalled('ready', false)).toBe('ready');
    expect(followStalled('buffering', true)).toBe('buffering');
  });

  it('加载中、失败与不支持不因等待而改变', () => {
    for (const status of ['loading', 'failed', 'unsupported'] satisfies VideoElementStatus[]) {
      expect(followStalled(status, true)).toBe(status);
      expect(followStalled(status, false)).toBe(status);
    }
  });
});
