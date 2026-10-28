import { describe, expect, it } from 'vitest';
import {
  readMusicListResult,
  readMusicLoginCode,
  readMusicLxAuth,
  readMusicLoginState,
  readMusicReply,
  readMusicResource,
  readMusicSearchResult,
  readMusicStatus,
  readMusicStreamFailures,
  readMusicTracks,
} from '../../../src/server/musicProtocol.ts';

const REF = { platform: 'wy', id: '0012' };
const SIGNED_OUT = { account: null, unblock: false, lxHosted: false };
const SERVER = { url: 'http://127.0.0.1:9527/', username: null, hasToken: false };
/** 配置文件读得出来时才有 lxServer。 */
const withServer = <T extends { lx: string }>(value: T) => ({
  ...SIGNED_OUT,
  lxServer: ['ready', 'catalog-unavailable'].includes(value.lx) ? SERVER : null,
  ...value,
});
const TRACK = {
  ref: REF,
  title: '歌曲',
  subtitle: null,
  artists: [
    { ref: { platform: 'wy', id: '7' }, name: '艺人甲' },
    { ref: null, name: '艺人乙' },
  ],
  album: { ref: null, title: '专辑' },
  durationMs: 218277,
  artwork: null,
  qualities: ['128k', 'flac'],
  access: 'vip',
};
const PAGE = { items: [TRACK], nextCursor: null, total: null, discardedCount: 0 };
const ALBUM = {
  ref: { platform: 'wy', id: '2098348' },
  title: 'modal soul',
  artists: [{ ref: { platform: 'wy', id: '162138' }, name: 'Nujabes' }],
  artwork: 'https://p4.music.126.net/l3rg9NXB6l6IOKFwCTYCPw==/1.jpg',
  releaseDate: '2005-11-11',
  trackCount: 14,
  kind: 'album',
};
const ARTIST = {
  ref: { platform: 'wy', id: '162138' },
  name: 'Nujabes',
  avatar: null,
  albumCount: 51,
  trackCount: 381,
};
const PLAYLIST = {
  ref: { platform: 'wy', id: '98567044' },
  title: 'Nujabes - Luv (sic) Pt.1~Pt.6',
  cover: 'https://p1.music.126.net/FO-WAVfIfIdQmDwCG92IPw==/2.jpg',
  trackCount: 46,
  kind: 'playlist',
  description: 'Nujabes Luv(sic) Pt.1-Pt.6 全收录',
  playCount: 1597042,
  updateNote: null,
};
const ITEMS = { album: ALBUM, artist: ARTIST, playlist: PLAYLIST };
const RESOURCE = {
  ref: REF,
  url: 'https://audio.example.test/12?signature=temporary',
  requestedQuality: 'flac',
  actualQuality: null,
  expiresAt: null,
  unblocked: true,
};

describe('音乐传输协议读取', () => {
  it('重建公开字段，保留字符串身份、未知值和完整署名', () => {
    const result = readMusicSearchResult(
      {
        ...PAGE,
        items: [{ ...TRACK, songInfo: { secret: 'private' }, ref: { ...REF, songmid: 12 } }],
        upstream: { private: true },
      },
      'track',
    );
    expect(result).toEqual(PAGE);
    expect(result?.items[0].ref.id).toBe('0012');
    expect(readMusicResource({ ...RESOURCE, headers: { Cookie: 'private' } })).toEqual(RESOURCE);
    // 音源名可有可无；不是字符串或是空的就当没有
    expect(readMusicResource({ ...RESOURCE, sourceName: '野花' })).toEqual({
      ...RESOURCE,
      sourceName: '野花',
    });
    for (const sourceName of [7, ' ', null])
      expect(readMusicResource({ ...RESOURCE, sourceName })).toEqual(RESOURCE);
  });

  it.each([
    { platforms: ['wy', 'tx', 'kw'], ncm: 'loaded', lx: 'ready' },
    { platforms: ['wy'], ncm: 'installed', lx: 'unconfigured' },
    { platforms: ['wy'], ncm: 'failed', lx: 'invalid-config' },
    { platforms: ['tx'], ncm: 'missing', lx: 'ready' },
    { platforms: [], ncm: 'missing', lx: 'catalog-unavailable' },
  ])('读取一致的配置状态 $ncm $lx', (value) => {
    const full = withServer(value);
    expect(readMusicStatus({ ...full, token: 'private' })).toEqual(full);
  });

  it('账号只交出昵称，昵称可以未知', () => {
    const base = {
      platforms: ['wy'],
      ncm: 'loaded',
      lx: 'unconfigured',
      lxServer: null,
      lxHosted: false,
      unblock: true,
    };
    expect(
      readMusicStatus({ ...base, account: { nickname: '听众', cookie: 'MUSIC_U=private' } }),
    ).toEqual({ ...base, account: { nickname: '听众' } });
    expect(readMusicStatus({ ...base, account: { nickname: null } })).toEqual({
      ...base,
      account: { nickname: null },
    });
    for (const patch of [{ account: 'x' }, { account: { nickname: '' } }, { unblock: 'true' }])
      expect(readMusicStatus({ ...base, account: null, ...patch })).toBeNull();
    expect(readMusicStatus({ platforms: ['wy'], ncm: 'loaded', lx: 'unconfigured' })).toBeNull();
  });

  it('lxServer 只给地址、用户名与有没有令牌，并与配置状态一致', () => {
    const ready = withServer({ platforms: ['tx'], ncm: 'missing', lx: 'ready' });
    const server = { url: 'http://nas.local:9527/', username: '听众', hasToken: true };
    expect(readMusicStatus({ ...ready, lxServer: { ...server, userToken: 'x' } })).toEqual({
      ...ready,
      lxServer: server,
    });
    for (const lxServer of [
      null,
      { ...server, url: 'ftp://nas.local/' },
      { ...server, hasToken: 'yes' },
      { ...server, username: '' },
    ])
      expect(readMusicStatus({ ...ready, lxServer })).toBeNull();
    const unconfigured = withServer({ platforms: [], ncm: 'missing', lx: 'unconfigured' });
    expect(readMusicStatus({ ...unconfigured, lxServer: server })).toBeNull();
    // 托管时没有自建连接；托管只在有记录可读或已就绪时成立。
    const hosted = { ...ready, lxServer: null, lxHosted: true };
    expect(readMusicStatus(hosted)).toEqual(hosted);
    expect(readMusicStatus({ ...hosted, lxServer: server })).toBeNull();
    expect(readMusicStatus({ ...unconfigured, lxHosted: true })).toBeNull();
    expect(readMusicStatus({ ...ready, lxHosted: undefined })).toBeNull();
    expect(readMusicLxAuth({ auth: 'valid' })).toBe('valid');
    expect(readMusicLxAuth({ auth: 'ok' })).toBeNull();
  });

  it('扫码登录只认 PNG 二维码与已知的扫码状态', () => {
    const code = { key: 'f2a1-unikey', image: 'data:image/png;base64,iVBORw0KGgo=' };
    expect(readMusicLoginCode({ ...code, url: 'https://music.163.com/login' })).toEqual(code);
    for (const patch of [
      { key: '' },
      { image: 'https://example.test/qr.png' },
      { image: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { image: `data:image/png;base64,${'A'.repeat(65536)}` },
    ])
      expect(readMusicLoginCode({ ...code, ...patch })).toBeNull();
    expect(readMusicLoginState({ state: 'signed-in', cookie: 'MUSIC_U=private' })).toBe(
      'signed-in',
    );
    expect(readMusicLoginState({ state: 'other' })).toBeNull();
  });

  it.each([
    { platforms: ['wy'], ncm: 'missing', lx: 'unconfigured' },
    { platforms: [], ncm: 'installed', lx: 'unconfigured' },
    { platforms: ['wy', 'wy'], ncm: 'loaded', lx: 'unconfigured' },
    { platforms: ['unknown'], ncm: 'missing', lx: 'ready' },
    { platforms: [], ncm: 'missing', lx: 'ready' },
    { platforms: ['tx'], ncm: 'missing', lx: 'unconfigured' },
    { platforms: [], ncm: 'other', lx: 'unconfigured' },
    { platforms: [], ncm: 'missing', lx: 'other' },
    { phase: 'ready', platforms: ['tx'] },
  ])('拒绝矛盾或未知的配置状态 %#', (value) => {
    expect(readMusicStatus(withServer({ lx: 'unconfigured', ...value }))).toBeNull();
  });

  it.each([
    { title: 42 },
    { title: null },
    { subtitle: '' },
    { artists: null },
    { artists: [{ ref: null, name: '' }] },
    { artists: [{ ref: { platform: 'unknown', id: '7' }, name: '艺人' }] },
    { artists: Array.from({ length: 101 }, () => ({ ref: null, name: '艺人' })) },
    { album: { ref: null, title: '' } },
    { album: { ref: { platform: 'wy' }, title: '专辑' } },
    { durationMs: -1 },
    { durationMs: 1.5 },
    { durationMs: Number.POSITIVE_INFINITY },
    { artwork: 'file:///private' },
    { artwork: 'https://user:pass@example.test/a' },
    { access: 'free-trial' },
    { access: undefined },
    { qualities: ['flac', 'flac'] },
    { qualities: ['unknown'] },
    { ref: { ...REF, id: 12 } },
    { ref: { ...REF, platform: 'unknown' } },
    { ref: { ...REF, id: 'x'.repeat(257) } },
    { title: 'x'.repeat(2049) },
  ])('拒绝不合法曲目字段，不把坏数据变成空搜索结果 %#', (patch) => {
    expect(readMusicSearchResult({ ...PAGE, items: [{ ...TRACK, ...patch }] }, 'track')).toBeNull();
  });

  it.each([
    { nextCursor: 2 },
    { nextCursor: '' },
    { nextCursor: 'page 2' },
    { nextCursor: 'x'.repeat(257) },
    { total: -1 },
    { total: 1.5 },
    { discardedCount: -1 },
    { discardedCount: 20 },
    { items: [], discardedCount: 1 },
    { items: [TRACK, TRACK] },
    {
      items: Array.from({ length: 21 }, (_, i) => ({ ...TRACK, ref: { ...REF, id: String(i) } })),
    },
  ])('拒绝不合法分页、超量和重复身份 %#', (patch) => {
    expect(readMusicSearchResult({ ...PAGE, ...patch }, 'track')).toBeNull();
  });

  it.each(['album', 'artist', 'playlist'] as const)('按类别重建%s的公开字段', (kind) => {
    const page = { ...PAGE, items: [ITEMS[kind]] };
    const extra = { ...page, items: [{ ...ITEMS[kind], upstream: { private: true } }] };
    expect(readMusicSearchResult(extra, kind)).toEqual(page);
  });

  it('专辑的种类可以是合集，版本类别省略或在已知的五种里', () => {
    const compilation = { ...ALBUM, kind: 'compilation' };
    expect(readMusicSearchResult({ ...PAGE, items: [compilation] }, 'album')?.items).toEqual([
      compilation,
    ]);
    for (const subType of ['studio', 'live', 'remix', 'instrumental', 'demo']) {
      const items = [{ ...ALBUM, subType }];
      expect(readMusicSearchResult({ ...PAGE, items }, 'album')?.items).toEqual(items);
    }
    expect(
      readMusicSearchResult({ ...PAGE, items: [ALBUM] }, 'album')?.items[0],
    ).not.toHaveProperty('subType');
  });

  it('按请求的类别读，别的类别的对象当格式错误', () => {
    expect(readMusicSearchResult({ ...PAGE, items: [ALBUM] }, 'track')).toBeNull();
    expect(readMusicSearchResult(PAGE, 'album')).toBeNull();
    expect(readMusicSearchResult({ ...PAGE, items: [PLAYLIST] }, 'artist')).toBeNull();
  });

  it.each([
    ['album', { releaseDate: '2005-11' }],
    ['album', { releaseDate: 20051111 }],
    ['album', { artists: [{ ref: null, name: '' }] }],
    ['album', { trackCount: -1 }],
    ['album', { kind: 'boxset' }],
    ['album', { subType: 'acoustic' }],
    ['album', { subType: null }],
    ['artist', { name: '' }],
    ['artist', { avatar: 'ftp://example.test/a.jpg' }],
    ['artist', { albumCount: 1.5 }],
    ['playlist', { cover: 'javascript:alert(1)' }],
    ['playlist', { title: ' ' }],
    ['playlist', { kind: 'radio' }],
    ['playlist', { playCount: -1 }],
    ['playlist', { description: 3 }],
  ] as const)('拒绝不合法的%s字段 %#', (kind, patch) => {
    const items = [{ ...ITEMS[kind], ...patch }];
    expect(readMusicSearchResult({ ...PAGE, items }, kind)).toBeNull();
  });

  it('在线列表按请求的类别读列表本身，曲目一页最多 1000 条', () => {
    const many = Array.from({ length: 1000 }, (_, index) => ({
      ...TRACK,
      ref: { platform: 'wy', id: String(index + 1) },
    }));
    const page = { ...PAGE, items: many, owner: PLAYLIST };
    expect(readMusicListResult({ ...page, owner: { ...PLAYLIST, extra: 1 } }, 'playlist')).toEqual(
      page,
    );
    expect(readMusicListResult(page, 'album')).toBeNull();
    expect(readMusicListResult({ ...PAGE, owner: null }, 'artist')).toBeNull();
    expect(readMusicListResult({ ...page, discardedCount: 1 }, 'playlist')).toBeNull();
    expect(readMusicListResult({ ...PAGE, items: [ALBUM], owner: ALBUM }, 'album')).toBeNull();
  });

  it.each(['unsupported', 'not-found'])('读出「%s」的失败', (code) => {
    const failure = { code, message: '音源不支持这项操作' };
    expect(readMusicReply({ protocol: 1, success: false, error: failure }, () => null)).toEqual({
      protocol: 1,
      success: false,
      error: failure,
    });
  });

  it('游标原样交回，读取上游给出的总数和真正的空页', () => {
    const more = { ...PAGE, nextCursor: 'offset:20', total: 293, discardedCount: 19 };
    expect(readMusicSearchResult(more, 'track')).toEqual(more);
    const empty = { ...PAGE, items: [] };
    expect(readMusicSearchResult(empty, 'track')).toEqual(empty);
  });

  it.each([
    { url: 'javascript:alert(1)' },
    { url: 'https://user:pass@example.test/a' },
    { url: `https://example.test/${'x'.repeat(2048)}` },
    { requestedQuality: 'unknown' },
    { actualQuality: 'unknown' },
    { expiresAt: -1 },
    { expiresAt: Number.POSITIVE_INFINITY },
    { ref: { ...REF, id: '' } },
    { unblocked: 'true' },
    { unblocked: undefined },
  ])('拒绝不合法播放资源 %#', (patch) => {
    expect(readMusicResource({ ...RESOURCE, ...patch })).toBeNull();
  });

  it('失败信封保留已知错误码，拒绝未知协议和损坏信封', () => {
    const failure = {
      protocol: 1,
      success: false,
      error: { code: 'track-missing', message: '曲目记录缺失' },
    };
    expect(readMusicReply(failure, readMusicResource)).toEqual(failure);
    expect(readMusicReply({ ...failure, protocol: 2 }, readMusicResource)).toBeNull();
    expect(
      readMusicReply({ ...failure, error: { code: 'other', message: '未知' } }, readMusicResource),
    ).toBeNull();
    expect(readMusicReply({ ...failure, success: 'false' }, readMusicResource)).toBeNull();
    expect(readMusicReply({ protocol: 1, success: true, data: {} }, readMusicResource)).toBeNull();
  });

  it('按 ID 取到的曲目逐条重建，坏记录或超量时整批拒绝', () => {
    expect(readMusicTracks([{ ...TRACK, extra: 1 }])).toEqual([TRACK]);
    expect(readMusicTracks([])).toEqual([]);
    expect(readMusicTracks([TRACK, { ...TRACK, title: '' }])).toBeNull();
    expect(readMusicTracks(Array(101).fill(TRACK))).toBeNull();
    expect(readMusicTracks({ items: [TRACK] })).toBeNull();
  });

  it('各档体积可省略；给了就只收档位键与正整数，空对象不留', () => {
    const sized = { ...TRACK, sizes: { '128k': 3493293, flac: 33974272 } };
    expect(readMusicTracks([sized])).toEqual([sized]);
    expect(readMusicTracks([{ ...TRACK, sizes: {} }])).toEqual([TRACK]);
    for (const sizes of [{ master: 1 }, { flac: 0 }, { flac: '32 MB' }, [1], null])
      expect(readMusicTracks([{ ...TRACK, sizes }])).toBeNull();
  });

  it('失败记录按序号从旧到新重建，额外字段不进入结果', () => {
    const item = { seq: 5, ref: REF, code: 'unblock-missing', at: 4 };
    const unblocked = { seq: 4, ref: REF, unblocked: true, at: 4 };
    expect(
      readMusicStreamFailures({
        latest: 6,
        items: [item, { ...item, seq: 6, url: 'x' }],
        sources: [
          { ...unblocked, url: 'x' },
          { ...unblocked, seq: 6, unblocked: false },
        ],
      }),
    ).toEqual({
      latest: 6,
      items: [item, { ...item, seq: 6 }],
      sources: [unblocked, { ...unblocked, seq: 6, unblocked: false }],
    });
    expect(readMusicStreamFailures({ latest: 0, items: [], sources: [] })).toEqual({
      latest: 0,
      items: [],
      sources: [],
    });
  });

  it.each([
    { latest: 6, items: [{ seq: 6 }, { seq: 5 }] },
    { latest: 6, items: [{ seq: 5 }, { seq: 5 }] },
    { latest: 4, items: [{ seq: 5 }] },
    { latest: 6, items: [{ seq: 5, code: 'other' }] },
    { latest: 6, items: [{ seq: 5, ref: { platform: 'xx', id: '7' } }] },
    { latest: 6, items: [{ seq: 5, at: -1 }] },
    { latest: 60, items: Array.from({ length: 51 }, (_, index) => ({ seq: index + 1 })) },
    { latest: -1, items: [] },
  ])('拒绝乱序、超出最新序号、未知原因与超量的失败记录 %#', ({ latest, items }) => {
    const base = { seq: 1, ref: REF, code: 'unplayable', at: 1 };
    expect(
      readMusicStreamFailures({
        latest,
        items: items.map((patch) => ({ ...base, ...patch })),
        sources: [],
      }),
    ).toBeNull();
  });

  it.each([
    [{ seq: 5, unblocked: 'yes' }],
    [{ seq: 7 }],
    [{ seq: 5 }, { seq: 5 }],
    [{ seq: 5, ref: { platform: 'xx', id: '7' } }],
  ])('拒绝来源记录里的非布尔值、乱序与超出最新序号 %#', (...sources) => {
    const base = { seq: 1, ref: REF, unblocked: true, at: 1 };
    expect(
      readMusicStreamFailures({
        latest: 6,
        items: [],
        sources: sources.map((patch) => ({ ...base, ...patch })),
      }),
    ).toBeNull();
    expect(readMusicStreamFailures({ latest: 6, items: [] })).toBeNull();
  });
});
