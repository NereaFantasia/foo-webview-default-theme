import { describe, expect, it } from 'vitest';
import { albumKeyOf } from '../../../src/host/libraryContract.ts';
import { onlineKey } from '../../../src/playback/onlineTracks.ts';
import type { MusicTrack } from '../../../src/server/musicObjects.ts';
import { onlineAddress } from '../../../src/server/onlineAddress.ts';
import {
  albumArtistLink,
  albumGenreLink,
  musicArtistLinks,
  musicTrackLinks,
  trackLinks,
  type LinkableTrack,
} from '../../../src/track/trackLinks.ts';

const NONE: ReadonlyMap<string, MusicTrack | null> = new Map();

function local(fields: Partial<LinkableTrack> = {}): LinkableTrack {
  return {
    path: 'D:\\Music\\a.flac',
    album: 'Album',
    artist: 'A, B',
    albumArtists: ['A'],
    artists: ['A', 'B'],
    ...fields,
  };
}

const REF = { platform: 'wy', id: '7' } as const;
const ONLINE_PATH = onlineAddress(1234, REF, '320k') ?? '';

function info(fields: Partial<MusicTrack> = {}): MusicTrack {
  return {
    ref: REF,
    title: 'T',
    subtitle: null,
    artists: [
      { ref: { platform: 'wy', id: '1' }, name: '甲' },
      { ref: null, name: '乙' },
    ],
    album: { ref: { platform: 'wy', id: '9' }, title: '专辑' },
    durationMs: null,
    artwork: null,
    qualities: [],
    access: null,
    ...fields,
  };
}

describe('trackLinks', () => {
  it('本地曲目：专辑按专辑键，艺人按多值标签逐个', () => {
    expect(trackLinks(local(), NONE)).toEqual({
      album: {
        text: 'Album',
        ref: {
          kind: 'album',
          key: albumKeyOf({ name: 'Album', albumArtist: 'A', albumId: undefined }),
        },
      },
      artists: [
        { text: 'A', ref: { kind: 'artist', name: 'A' } },
        { text: 'B', ref: { kind: 'artist', name: 'B' } },
      ],
    });
  });

  it('宿主给了专辑 ID 时用它作键', () => {
    const links = trackLinks(local({ albumId: 'id-1' }), NONE);
    expect(links.album?.ref).toEqual({ kind: 'album', key: 'id-1' });
  });

  it('艺人名原样作身份：不拆 feat. 与分隔符，去掉空名与重名', () => {
    const links = trackLinks(local({ artists: ['X feat. Y', ' ', '', 'X feat. Y', 'C/D'] }), NONE);
    expect(links.artists.map((item) => item.text)).toEqual(['X feat. Y', 'C/D']);
  });

  it('没有多值艺人标签时整串只显示，不当成一位艺人', () => {
    const links = trackLinks(local({ artists: undefined }), NONE);
    expect(links.artists).toEqual([{ text: 'A, B', ref: null }]);
  });

  it('多值艺人标签为空或全是空白时，整串署名只显示', () => {
    for (const artists of [[], ['', ' ']]) {
      expect(trackLinks(local({ artists }), NONE).artists).toEqual([{ text: 'A, B', ref: null }]);
    }
  });

  it('没有专辑名时没有专辑，没有艺人时艺人为空', () => {
    const links = trackLinks(local({ album: '', artists: [], artist: '' }), NONE);
    expect(links).toEqual({ album: null, artists: [] });
  });

  it('在线曲目按后端署名链到在线列表，没有平台 ID 的只显示', () => {
    const online = new Map([[onlineKey(REF), info()]]);
    const links = trackLinks(local({ path: ONLINE_PATH }), online);
    expect(links.album).toEqual({
      text: '专辑',
      ref: {
        kind: 'onlineList',
        list: { kind: 'album', ref: { platform: 'wy', id: '9' }, title: '专辑' },
      },
    });
    expect(links.artists).toEqual([
      {
        text: '甲',
        ref: {
          kind: 'onlineList',
          list: { kind: 'artist', ref: { platform: 'wy', id: '1' }, title: '甲' },
        },
      },
      { text: '乙', ref: null },
    ]);
  });

  it('在线曲目的展示信息还没到或后端答没有时只显示标签', () => {
    const track = local({ path: ONLINE_PATH });
    const pending = trackLinks(track, NONE);
    expect(pending).toEqual({
      album: { text: 'Album', ref: null },
      artists: [{ text: 'A, B', ref: null }],
    });
    expect(trackLinks(track, new Map([[onlineKey(REF), null]]))).toEqual(pending);
  });

  it('同一行在同一份在线信息下复用结果，在线信息换了重算', () => {
    const track = local({ path: ONLINE_PATH });
    const first = trackLinks(track, NONE);
    expect(trackLinks(track, NONE)).toBe(first);
    const arrived = trackLinks(track, new Map([[onlineKey(REF), info()]]));
    expect(arrived).not.toBe(first);
    expect(arrived.artists[0]?.ref).not.toBeNull();
  });
});

describe('albumArtistLink', () => {
  it('取专辑艺术家，没有时退回艺人，署名原样作身份', () => {
    expect(albumArtistLink({ albumArtist: 'A feat. B', artist: 'X' })).toEqual({
      text: 'A feat. B',
      ref: { kind: 'artist', name: 'A feat. B' },
    });
    expect(albumArtistLink({ albumArtist: '', artist: 'X' })?.ref).toEqual({
      kind: 'artist',
      name: 'X',
    });
  });

  it('署名为空或全是空白时没有', () => {
    expect(albumArtistLink({ albumArtist: '', artist: '' })).toBeNull();
    expect(albumArtistLink({ albumArtist: ' ', artist: '' })).toBeNull();
  });
});

describe('albumGenreLink', () => {
  it('流派按标签原值作引用', () => {
    expect(albumGenreLink({ genre: 'Hip-Hop/Jazz' })).toEqual({
      text: 'Hip-Hop/Jazz',
      ref: { kind: 'genre', value: 'Hip-Hop/Jazz' },
    });
  });

  it('没有流派、全是空白或保留前缀开头的没有引用', () => {
    expect(albumGenreLink({ genre: '' })).toBeNull();
    expect(albumGenreLink({ genre: '  ' })).toBeNull();
    expect(albumGenreLink({ genre: '\0["A","B"]' })).toBeNull();
  });
});

describe('在线对象的可跳对象', () => {
  it('musicTrackLinks：手上有展示信息时直接取，艺人去重、没有平台 ID 的只显示', () => {
    const links = musicTrackLinks(info());
    expect(links.artists).toEqual([
      {
        text: '甲',
        ref: {
          kind: 'onlineList',
          list: { kind: 'artist', ref: { platform: 'wy', id: '1' }, title: '甲' },
        },
      },
      { text: '乙', ref: null },
    ]);
    expect(links.album?.ref).toEqual({
      kind: 'onlineList',
      list: { kind: 'album', ref: { platform: 'wy', id: '9' }, title: '专辑' },
    });
    expect(musicTrackLinks(info({ album: null })).album).toBeNull();
    expect(musicTrackLinks(info({ album: { ref: null, title: '专辑' } })).album).toEqual({
      text: '专辑',
      ref: null,
    });
  });

  it('musicArtistLinks：空名丢弃、同名只留一个，保持上游顺序', () => {
    const ref = { platform: 'wy', id: '1' } as const;
    expect(
      musicArtistLinks([
        { ref, name: 'A' },
        { ref: null, name: ' ' },
        { ref, name: 'A' },
        { ref: null, name: 'B' },
      ]).map((item) => [item.text, item.ref === null]),
    ).toEqual([
      ['A', false],
      ['B', true],
    ]);
  });
});
