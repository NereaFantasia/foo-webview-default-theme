import { describe, expect, test } from 'vitest';
import {
  analysisPlan,
  ONLINE_ANALYSIS_CHOICES,
  type OnlineAnalysis,
} from '../../../src/host/onlineAnalysis.ts';

const LOCAL = ['E:\\Music\\a.flac', 'file://E:/Music/a.cue', 'cdda://1:03'];
const RADIO = 'http://radio.example/live';
const ONLINE = 'http://127.0.0.1:51234/music/stream/wy/3347766479.flac?q=flac';

describe('整轨分析怎么取', () => {
  test.each(ONLINE_ANALYSIS_CHOICES)('本地曲目不看选择，照原地址读（选 %s）', (choice) => {
    for (const path of LOCAL) expect(analysisPlan(path, choice)).toBe('read');
  });

  test.each(ONLINE_ANALYSIS_CHOICES)('电台流没有整轨，不论选什么都不取（选 %s）', (choice) => {
    expect(analysisPlan(RADIO, choice)).toBe('skip');
  });

  test('在线曲目按选择：预载先通知后端，分段直接读，关闭不取', () => {
    const plans = ONLINE_ANALYSIS_CHOICES.map((choice: OnlineAnalysis) =>
      analysisPlan(ONLINE, choice),
    );
    expect(plans).toStrictEqual(['hold', 'read', 'skip']);
  });
});
