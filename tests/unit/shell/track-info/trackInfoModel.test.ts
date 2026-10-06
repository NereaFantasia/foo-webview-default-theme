import { describe, expect, test } from 'vitest';
import {
  copyInfoTags,
  filterInfoTags,
  findInfoTag,
  infoFilePath,
  infoIdentity,
  emptyTrackInfo,
  infoMediaKind,
  infoTags,
  infoTitle,
} from '../../../../src/shell/track-info/trackInfoModel.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

describe('信息字段保真', () => {
  test('重读后身份采用新标签；删除标题时仅用文件名回退', () => {
    const state = {
      ...emptyTrackInfo(makeTrack({ path: 'file://E:/old.flac', title: '旧标题' })),
      metadata: {
        status: 'ready' as const,
        value: {
          success: true as const,
          path: '',
          tags: { ARTIST: ['A, B', 'C'] },
          info: { duration: 1, bitrate: 1, sampleRate: 1, channels: 1, codec: '' },
        },
      },
    };
    const identity = infoIdentity(state);
    expect(identity?.title).toBe('');
    expect(identity?.artists).toEqual(['A, B', 'C']);
    expect(identity && infoTitle(identity)).toBe('old');
  });
  test('保留字段大小写、空值与多值，搜索字段和值，复制能无损恢复', () => {
    const raw = { Artist: ['Earth, Wind & Fire', 'Nujabes'], Empty: '', Custom: ['x', 'x'] };
    const tags = infoTags(raw);
    expect(findInfoTag(tags, ['ARTIST'])).toEqual(raw.Artist);
    expect(filterInfoTags(tags, ' wind ')).toEqual([tags[0]]);
    expect(filterInfoTags(tags, 'CUSTOM')).toEqual([tags[2]]);
    expect(JSON.parse(copyInfoTags(tags))).toEqual(raw);
  });

  test('文件名回退只用于标题，不伪造 TITLE 或曲序标签', () => {
    expect(infoTitle(makeTrack({ title: '', path: 'file://E:/Music/07 Unknown.flac' }))).toBe(
      '07 Unknown',
    );
    expect(infoTags({})).toEqual([]);
  });

  test('网络、自定义协议、容器与物理文件分开；分轨不会改物理路径', () => {
    const cue = makeTrack({ path: 'file://E:/Music/album.cue', subsong: 5 });
    expect(infoMediaKind(cue)).toBe('file');
    expect(infoFilePath(cue)).toBe('E:/Music/album.cue');
    for (const path of ['https://x/a', 'spotify:track:abc', 'mms://x']) {
      const track = makeTrack({ path });
      expect(infoMediaKind(track)).toBe('stream');
      expect(infoFilePath(track)).toBeNull();
    }
    expect(infoMediaKind(makeTrack({ path: 'unpack://zip|E:/x.zip|a.flac' }))).toBe('container');
    expect(infoFilePath(makeTrack({ path: 'file-relative://a.flac' }))).toBeNull();
  });
});
