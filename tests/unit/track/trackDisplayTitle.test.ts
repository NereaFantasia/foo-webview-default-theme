import { describe, expect, it } from 'vitest';
import { trackDisplayTitle } from '../../../src/track/trackDisplayTitle.ts';

describe('trackDisplayTitle', () => {
  it.each([
    ['标签标题', 'E:\\video\\file.mp4', '标签标题'],
    [
      '',
      'file-relative://..\\..\\OST\\09. Sewerslvt - blissful overdose.MP4',
      '09. Sewerslvt - blissful overdose',
    ],
    ['', 'E:\\video\\sample.mp4', 'sample'],
    ['', 'file:///E:/video/sample.mp4', 'sample'],
    ['', '/music/title.live.flac', 'title.live'],
    ['', '/music/no-extension', 'no-extension'],
    ['', '', ''],
  ])('标题 %s、路径 %s 显示为 %s', (title, path, expected) => {
    const track = { title, path };
    expect(trackDisplayTitle(track)).toBe(expected);
    expect(track).toEqual({ title, path });
  });
});
