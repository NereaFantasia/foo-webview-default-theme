import { describe, expect, it } from 'vitest';
import {
  readNcmAlbum,
  readNcmAlbumList,
  readNcmArtist,
  readNcmArtistAlbums,
  readNcmArtistList,
  readNcmPlaylist,
  readNcmPlaylistDetail,
  readNcmSearchPage,
  readNcmTrack,
  readNcmTracks,
} from '../../music/ncmRecords.ts';

// 摘自 2026-10-12 不登录的 cloudsearch 应答：会员曲目，四档都有，另带 192k 的 m 与平台私有字段。
const LEVEL = { br: 128000, fid: 0, size: 3493293, vd: 28526, sr: 48000 };
const SONG = {
  id: 64317,
  name: '因为爱情',
  alia: ['电影《将爱情进行到底》主题曲'],
  ar: [
    { id: 2116, name: '陈奕迅', tns: [], alias: ['Eason Chan'] },
    { id: 9621, name: '王菲', tns: [], alias: ['Faye Wong'] },
  ],
  al: {
    id: 6355,
    name: 'Stranger Under My Skin',
    picUrl: 'http://p4.music.126.net/9-PMVvRGgYw4uZYwteDkiQ==/109951171301957274.jpg',
  },
  dt: 218277,
  fee: 1,
  l: LEVEL,
  m: { ...LEVEL, br: 192000 },
  h: { ...LEVEL, br: 320000 },
  sq: { ...LEVEL, br: 728060 },
  hr: { ...LEVEL, br: 2430848, sr: 96000 },
  mv: 14248855,
  mark: 17716748288,
  privilege: { id: 64317, fee: 1, st: 0, pl: 0, maxBrLevel: 'jymaster' },
};

// 摘自 2026-10-17 不登录的 cloudsearch 应答（专辑、艺人、歌单），只留转换用到的字段与几个私有字段。
const ALBUM = {
  id: 2098348,
  name: 'modal soul',
  type: '专辑',
  size: 14,
  picUrl: 'https://p4.music.126.net/l3rg9NXB6l6IOKFwCTYCPw==/109951170165186772.jpg',
  publishTime: 1131638400000,
  company: 'Hydeout Productions',
  artist: { id: 162138, name: 'Nujabes', albumSize: 51 },
  artists: [{ id: 162138, name: 'Nujabes' }],
};
const ARTIST = {
  id: 162138,
  name: 'Nujabes',
  picUrl: 'https://p4.music.126.net/k6EO07Tl1VeajQzs80uzsw==/109951165416860404.jpg',
  alias: ['瀬葉淳'],
  albumSize: 51,
  musicSize: 381,
  img1v1Url: 'https://p3.music.126.net/noxyhdYRNaNnKGLipHCMcg==/1426066590158496.jpg',
  mvSize: 4,
};
const PLAYLIST = {
  id: 98567044,
  name: 'Nujabes - Luv (sic) Pt.1~Pt.6',
  coverImgUrl: 'http://p1.music.126.net/FO-WAVfIfIdQmDwCG92IPw==/3243559305677514.jpg',
  creator: { nickname: 'PillowPhilia', userId: 71486184 },
  trackCount: 46,
  playCount: 1594056,
};

describe('NCM 适配的转换', () => {
  it('专辑、艺人与歌单转成统一对象，私有字段不外露', () => {
    expect(readNcmAlbum(ALBUM)).toEqual({
      ref: { platform: 'wy', id: '2098348' },
      title: 'modal soul',
      artists: [{ ref: { platform: 'wy', id: '162138' }, name: 'Nujabes' }],
      artwork: 'https://p4.music.126.net/l3rg9NXB6l6IOKFwCTYCPw==/109951170165186772.jpg',
      releaseDate: '2005-11-11',
      trackCount: 14,
      kind: 'album',
    });
    expect(readNcmArtist(ARTIST)).toEqual({
      ref: { platform: 'wy', id: '162138' },
      name: 'Nujabes',
      avatar: 'https://p4.music.126.net/k6EO07Tl1VeajQzs80uzsw==/109951165416860404.jpg',
      albumCount: 51,
      trackCount: 381,
    });
    expect(readNcmPlaylist(PLAYLIST)).toEqual({
      ref: { platform: 'wy', id: '98567044' },
      title: 'Nujabes - Luv (sic) Pt.1~Pt.6',
      cover: 'https://p1.music.126.net/FO-WAVfIfIdQmDwCG92IPw==/3243559305677514.jpg',
      trackCount: 46,
      kind: 'playlist',
      description: null,
      playCount: 1594056,
      updateNote: null,
    });
    const all = JSON.stringify([
      readNcmAlbum(ALBUM),
      readNcmArtist(ARTIST),
      readNcmPlaylist(PLAYLIST),
    ]);
    expect(all).not.toMatch(/Hydeout|img1v1|1426066590158496|瀬葉淳|PillowPhilia/);
  });

  it('专辑种类只认专辑、Single、EP 与精选集；榜单按详情里的榜单代号认，简介与更新说明原样带上', () => {
    const kind = (type: unknown) => readNcmAlbum({ ...ALBUM, type })?.kind;
    expect([
      kind('专辑'),
      kind('Single'),
      kind('EP'),
      kind('精选集'),
      kind('EP/Single'),
      kind(undefined),
    ]).toEqual(['album', 'single', 'ep', 'compilation', null, null]);
    expect(
      readNcmPlaylist({
        ...PLAYLIST,
        ToplistType: 'H',
        description: '  云音乐热歌榜  ',
        updateFrequency: '刚刚更新',
      }),
    ).toMatchObject({ kind: 'chart', description: '云音乐热歌榜', updateNote: '刚刚更新' });
    expect(readNcmPlaylist({ ...PLAYLIST, ToplistType: '', playCount: -1 })).toMatchObject({
      kind: 'playlist',
      playCount: null,
    });
  });

  it('版本类别只认五种写法，搜索结果的记录没有这个字段，认不出的省略', () => {
    const subType = (value: unknown) => readNcmAlbum({ ...ALBUM, subType: value });
    expect(
      ['录音室版', '现场版', 'Remix', '伴奏版', 'DEMO'].map((name) => subType(name)?.subType),
    ).toEqual(['studio', 'live', 'remix', 'instrumental', 'demo']);
    expect(readNcmAlbum(ALBUM)).not.toHaveProperty('subType');
    expect(subType('原声带')).not.toHaveProperty('subType');
    expect(subType(1)).not.toHaveProperty('subType');
  });

  it('艺人专辑按偏移分页：游标看 more 与总数，总数取 artist.albumSize，重复与坏记录不外露', () => {
    const body = (more: unknown, hotAlbums: unknown[], albumSize: unknown = 51) => ({
      code: 200,
      more,
      artist: { id: 162138, name: 'Nujabes', albumSize },
      hotAlbums,
    });
    const live = { ...ALBUM, id: 7, type: 'Single', subType: '现场版', size: 2 };
    const page = readNcmArtistAlbums(body(true, [ALBUM, ALBUM, live, { id: 'x' }]), 0);
    expect(page).toMatchObject({ total: 51, nextCursor: '4', discardedCount: 2 });
    expect(page.items.map((album) => [album.ref.id, album.kind, album.subType])).toEqual([
      ['2098348', 'album', undefined],
      ['7', 'single', 'live'],
    ]);
    expect(readNcmArtistAlbums(body(true, [ALBUM]), 10).nextCursor).toBe('11');
    // 取到总数、上游说没有更多、或本页是空的，都不再续页
    expect(readNcmArtistAlbums(body(true, [ALBUM, live]), 49).nextCursor).toBeNull();
    expect(readNcmArtistAlbums(body(false, [ALBUM]), 0).nextCursor).toBeNull();
    expect(readNcmArtistAlbums(body(true, []), 400).nextCursor).toBeNull();
    expect(readNcmArtistAlbums(body(true, [ALBUM], null), 0)).toMatchObject({
      total: null,
      nextCursor: '1',
    });
    expect(readNcmArtistAlbums({ code: 200, artist: { albumSize: 0 } }, 0)).toMatchObject({
      items: [],
      total: 0,
      nextCursor: null,
    });
    expect(() => readNcmArtistAlbums(body(true, Array(201).fill(ALBUM)), 0)).toThrow(
      expect.objectContaining({ code: 'invalid-upstream' }),
    );
    expect(() => readNcmArtistAlbums({ code: 200, hotAlbums: [ALBUM] }, 0)).toThrow(
      expect.objectContaining({ code: 'invalid-upstream' }),
    );
    expect(() => readNcmArtistAlbums(body(false, [{ id: 'x' }]), 0)).toThrow(
      expect.objectContaining({ code: 'invalid-upstream' }),
    );
  });

  it('发行日期按东八区取，0 当没填；没有 artists 时用 artist；没照片不拿默认头像充数', () => {
    const date = (publishTime: unknown) => readNcmAlbum({ ...ALBUM, publishTime })?.releaseDate;
    expect(date(-315648000000)).toBe('1960-01-01');
    expect(date(0)).toBeNull();
    expect(date('1131638400000')).toBeNull();
    expect(date(Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(readNcmAlbum({ ...ALBUM, artists: undefined })?.artists).toEqual([
      { ref: { platform: 'wy', id: '162138' }, name: 'Nujabes' },
    ]);
    const bare = { ...ARTIST, id: 61238087, picUrl: null, alias: [] };
    expect(readNcmArtist(bare)).toMatchObject({ avatar: null });
    expect(readNcmPlaylist({ ...PLAYLIST, id: 0 })).toBeNull();
    expect(readNcmAlbum({ ...ALBUM, name: ' ' })).toBeNull();
  });

  it('按类别分页：列表与总数的字段随类别变，翻过末页的空页照常读', () => {
    const albums = readNcmSearchPage(
      { code: 200, result: { albums: [ALBUM, ALBUM, { id: 'x' }], albumCount: 358 } },
      0,
      'album',
    );
    expect(albums).toMatchObject({ total: 358, discardedCount: 2, nextCursor: null });
    expect(albums.items.map((album) => album.title)).toEqual(['modal soul']);
    expect(readNcmSearchPage({ code: 200, result: { artistCount: 0 } }, 20, 'artist')).toEqual({
      items: [],
      discardedCount: 0,
      nextCursor: null,
      total: 0,
    });
    expect(() =>
      readNcmSearchPage({ code: 200, result: { playlists: [{}] } }, 0, 'playlist'),
    ).toThrow(expect.objectContaining({ code: 'invalid-upstream' }));
  });

  it('搜索记录转成统一曲目：身份、署名、毫秒时长、https 封面与档位，私有字段不外露', () => {
    const track = readNcmTrack(SONG);
    expect(track).toEqual({
      ref: { platform: 'wy', id: '64317' },
      title: '因为爱情',
      subtitle: '电影《将爱情进行到底》主题曲',
      artists: [
        { ref: { platform: 'wy', id: '2116' }, name: '陈奕迅' },
        { ref: { platform: 'wy', id: '9621' }, name: '王菲' },
      ],
      album: { ref: { platform: 'wy', id: '6355' }, title: 'Stranger Under My Skin' },
      durationMs: 218277,
      artwork: 'https://p4.music.126.net/9-PMVvRGgYw4uZYwteDkiQ==/109951171301957274.jpg',
      qualities: ['128k', '320k', 'flac', 'flac24bit'],
      sizes: { '128k': 3493293, '320k': 3493293, flac: 3493293, flac24bit: 3493293 },
      access: 'vip',
    });
    expect(JSON.stringify(track)).not.toMatch(/privilege|jymaster|14248855/);
  });

  it('各档体积只记正整数；一档都没有时省略', () => {
    const track = readNcmTrack({ ...SONG, l: { size: 0 }, h: { size: '3 MB' }, sq: {} });
    expect(track?.qualities).toEqual(['128k', '320k', 'flac', 'flac24bit']);
    expect(track?.sizes).toEqual({ flac24bit: 3493293 });
    expect(readNcmTrack({ ...SONG, l: {}, h: {}, sq: {}, hr: {} })).not.toHaveProperty('sizes');
  });

  it.each([
    [{ fee: 0 }, undefined, 'free'],
    [{ fee: 8 }, undefined, 'free'],
    [{ fee: 1 }, undefined, 'vip'],
    [{ fee: 4 }, undefined, 'purchase'],
    [{ fee: 2 }, undefined, null],
    [{ fee: 0 }, { st: -200 }, 'unavailable'],
    [{ fee: 1, privilege: { st: -200 } }, undefined, 'unavailable'],
    [{ fee: 1, privilege: { st: -200 } }, { st: 0 }, 'vip'],
  ])('可听性：%j，单独的权限 %j → %s', (patch, privilege, expected) => {
    expect(readNcmTrack({ ...SONG, privilege: undefined, ...patch }, privilege)?.access).toBe(
      expected,
    );
  });

  it('形状不符或缺失的可选字段记为空，不推测', () => {
    const track = readNcmTrack({
      id: 7,
      name: ' 曲目 ',
      alia: '[0]',
      tns: ['译名'],
      ar: [{ id: 0, name: '未收录' }, { id: 3, name: '  ' }, null],
      al: { id: 9, name: '' },
      dt: -1,
    });
    expect(track).toEqual({
      ref: { platform: 'wy', id: '7' },
      title: '曲目',
      subtitle: '译名',
      artists: [{ ref: null, name: '未收录' }],
      album: null,
      durationMs: null,
      artwork: null,
      qualities: [],
      access: null,
    });
    expect(readNcmTrack({ ...SONG, al: { ...SONG.al, picUrl: 'file:///C:/a.jpg' } })?.artwork).toBe(
      null,
    );
  });

  it.each([{ ...SONG, id: 0 }, { ...SONG, id: '64317' }, { ...SONG, name: ' ' }, null])(
    '没有身份或标题的记录不产出曲目 %#',
    (song) => {
      expect(readNcmTrack(song)).toBeNull();
    },
  );

  it('详情接口的权限放在单独数组里，按 ID 对上；重复与坏记录丢弃并计数', () => {
    const songs = [{ ...SONG, privilege: undefined }, SONG, { id: 5 }, { ...SONG, id: 8, fee: 0 }];
    const privileges = [
      { id: 8, st: -200 },
      { id: 64317, st: 0 },
    ];
    const answer = readNcmTracks(songs, privileges);
    expect(answer.items.map((track) => [track.ref.id, track.access])).toEqual([
      ['64317', 'vip'],
      ['8', 'unavailable'],
    ]);
    expect(answer.discardedCount).toBe(2);
    expect(() => readNcmTracks([{ id: 5 }])).toThrow(
      expect.objectContaining({ code: 'invalid-upstream' }),
    );
    expect(readNcmTracks([])).toEqual({ items: [], discardedCount: 0 });
  });

  it('搜索分页：总数取 songCount，满页且未到总数才给下一页的偏移', () => {
    const page = (count: number, offset: number, songCount: unknown) =>
      readNcmSearchPage(
        {
          code: 200,
          result: {
            songs: Array.from({ length: count }, (_, index) => ({
              ...SONG,
              id: offset + index + 1,
            })),
            songCount,
          },
        },
        offset,
        'track',
      );
    expect(page(20, 0, 293)).toMatchObject({ nextCursor: '20', total: 293, discardedCount: 0 });
    expect(page(20, 280, 300)).toMatchObject({ nextCursor: null, total: 300 });
    expect(page(13, 280, 293)).toMatchObject({ nextCursor: null, total: 293 });
    expect(page(20, 0, '293')).toMatchObject({ nextCursor: '20', total: null });
    expect(readNcmSearchPage({ code: 200, result: { songCount: 0 } }, 0, 'track')).toEqual({
      items: [],
      discardedCount: 0,
      nextCursor: null,
      total: 0,
    });
  });

  it.each([
    null,
    {},
    { result: [] },
    { result: { songs: {} } },
    { result: { songs: Array(21).fill(SONG) } },
  ])('应答形状不对时报格式错误，不当成没有结果 %#', (body) => {
    expect(() => readNcmSearchPage(body, 0, 'track')).toThrow(
      expect.objectContaining({ code: 'invalid-upstream' }),
    );
  });
  it('专辑列表的总数取专辑的曲目数，艺人热门没有总数；都不给续页', () => {
    expect(readNcmAlbumList({ album: ALBUM, songs: [SONG] })).toMatchObject({
      owner: { title: 'modal soul' },
      items: [{ title: '因为爱情' }],
      nextCursor: null,
      total: 14,
    });
    expect(readNcmArtistList({ artist: ARTIST, hotSongs: [SONG] })).toMatchObject({
      owner: { name: 'Nujabes' },
      nextCursor: null,
      total: null,
    });
  });

  it.each([
    () => readNcmAlbumList({ songs: [SONG] }),
    () => readNcmAlbumList({ album: ALBUM, songs: Array(1001).fill(SONG) }),
    () => readNcmArtistList({ artist: ARTIST }),
    () => readNcmPlaylistDetail({ playlist: { ...PLAYLIST, tracks: [] } }),
    () => readNcmPlaylistDetail({ playlist: { ...PLAYLIST, trackIds: [] } }),
    () => readNcmPlaylistDetail({ playlist: { ...PLAYLIST, trackIds: [{ id: '1' }], tracks: [] } }),
  ])('列表本身或曲目 ID 缺失、超量时报格式错误 %#', (read) => {
    expect(read).toThrow(expect.objectContaining({ code: 'invalid-upstream' }));
  });

  it('歌单详情交出全部 ID，曲目最多取前 1000 首并记下取了几首', () => {
    const trackIds = Array.from({ length: 1200 }, (_, index) => ({ id: index + 1 }));
    const tracks = trackIds.map(({ id }) => ({ id, name: `曲目 ${id}`, fee: 8 }));
    const detail = readNcmPlaylistDetail({
      playlist: { ...PLAYLIST, trackIds, tracks },
      privileges: [{ id: 1, st: -200 }],
    });
    expect(detail.owner).toMatchObject({ title: 'Nujabes - Luv (sic) Pt.1~Pt.6' });
    expect(detail.ids).toHaveLength(1200);
    expect(detail.first?.taken).toBe(1000);
    expect(detail.first?.items[0]).toMatchObject({ ref: { id: '1' }, access: 'unavailable' });
    expect(
      readNcmPlaylistDetail({ playlist: { ...PLAYLIST, trackIds, tracks: [] } }).first,
    ).toBeNull();
  });
});
