import { describe, expect, it } from 'vitest';
import type { MessageKey } from '../../../src/i18n/en.ts';
import { onlineKey } from '../../../src/playback/onlineTracks.ts';
import type { MusicTrack } from '../../../src/server/musicObjects.ts';
import { displayOf } from '../../../src/track/displayTrack.ts';
import { musicTrack } from '../../fixtures/music.ts';
import { makeTrack } from '../../fixtures/tracks.ts';

const t = (key: MessageKey) => (key === 'online.unknownTitle' ? '未知曲目' : key);
const ONLINE = 'http://127.0.0.1:51234/music/stream/wy/3347766479.flac?q=flac';

describe('曲目在界面上怎么写', () => {
  it('在线曲目套上展示信息，标题、艺人与专辑都照它写', () => {
    const online = new Map<string, MusicTrack | null>([
      [
        onlineKey({ platform: 'wy', id: '3347766479' }),
        musicTrack('3347766479', { title: 'Until Our Sky Is Blue' }),
      ],
    ]);
    const shown = displayOf(makeTrack({ path: ONLINE, title: '', artist: '' }), online, t);
    expect(shown.title).toBe('Until Our Sky Is Blue');
    expect(shown.track.artist).toBe('Nujabes');
    expect(shown.track.album).toBe('Modal Soul');
  });

  it('在线曲目还没有展示信息时写「未知曲目」，不把平台 ID 当曲名', () => {
    expect(displayOf(makeTrack({ path: ONLINE, title: '' }), new Map(), t).title).toBe('未知曲目');
  });

  it('本地曲目原样：没有标题标签时写去掉扩展名的文件名', () => {
    const local = makeTrack({ path: 'file://E:/Music/Feather.flac', title: '' });
    expect(displayOf(local, new Map(), t)).toEqual({ track: local, title: 'Feather' });
  });
});
