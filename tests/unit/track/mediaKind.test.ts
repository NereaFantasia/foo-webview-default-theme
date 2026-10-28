import { describe, expect, it } from 'vitest';
import { isVideoPath, videoExtensionOf } from '../../../src/track/mediaKind.ts';

describe('按扩展名认视频文件', () => {
  it('认常见的视频封装，不分大小写，路径带子曲目后缀也认', () => {
    expect(videoExtensionOf('E:\\Music\\a\\clip.MP4')).toBe('mp4');
    expect(videoExtensionOf('file-relative://..\\..\\OST\\x.mkv|subsong:2')).toBe('mkv');
    expect(videoExtensionOf('D:\\v\\old.avi')).toBe('avi');
    expect(isVideoPath('E:\\a\\b.webm')).toBe(true);
  });

  it('音频、没有扩展名与常装纯音频的封装不算', () => {
    for (const path of ['E:\\a.flac', 'E:\\a.m4a', 'E:\\a.mka', 'E:\\a.asf', 'E:\\a.3gp']) {
      expect(isVideoPath(path)).toBe(false);
    }
    expect(videoExtensionOf('http://stream.example/live')).toBeNull();
    expect(videoExtensionOf('E:\\folder.mp4\\song')).toBeNull();
  });
});
