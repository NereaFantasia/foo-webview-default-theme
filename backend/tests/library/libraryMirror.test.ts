import { statSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startLibraryMirror } from '../../library/libraryMirror.ts';
import {
  LIBRARY_MIRROR_SCHEMA,
  MIRROR_SORT_COLUMNS,
  readMirrorAlbums,
  readMirrorApply,
  readMirrorArtists,
  readMirrorOrder,
  readMirrorPage,
  readMirrorStatus,
  type MirrorSortColumn,
  type MirrorTrack,
} from '../../../src/server/libraryMirrorProtocol.ts';

const DIRECTORIES: string[] = [];
const CLOSE: (() => void)[] = [];

afterEach(async () => {
  for (const close of CLOSE.splice(0)) close();
  for (const directory of DIRECTORIES.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'theme-library-mirror-')));
  DIRECTORIES.push(path);
  return path;
}

function open(path: string) {
  const mirror = startLibraryMirror(path);
  CLOSE.push(() => mirror.dispose());
  return mirror;
}

type Mirror = ReturnType<typeof open>;

function track(name: string, over: Partial<MirrorTrack> = {}): MirrorTrack {
  return {
    handle: `D:\\music\\${name}.flac`,
    path: `file://D:\\music\\${name}.flac`,
    absolutePath: `D:\\music\\${name}.flac`,
    subsong: 0,
    title: name,
    artist: 'Artist',
    artists: ['Artist'],
    album: 'Album',
    albumArtist: 'Artist',
    albumArtists: ['Artist'],
    genre: 'Rock',
    date: '2020',
    trackNumber: 1,
    discNumber: 1,
    duration: 180.4,
    fileSize: 1000,
    bitrate: 900,
    sampleRate: 44100,
    channels: 2,
    codec: 'FLAC',
    rating: 0,
    ...over,
  };
}

function rebuild(mirror: Mirror, tracks: readonly MirrorTrack[], epoch = 'E1', revision = 1) {
  const begun = mirror.request('rebuild-begin', {}) as { generation: number };
  for (let at = 0; at < tracks.length; at += 50) {
    mirror.request('rebuild-put', {
      generation: begun.generation,
      rows: tracks.slice(at, at + 50),
      indexFrom: at,
    });
  }
  mirror.request('rebuild-commit', { generation: begun.generation, epoch, revision });
}

function titles(mirror: Mirror, sort: MirrorSortColumn, descending = false, limit = 7): string[] {
  const out: string[] = [];
  let after: string | null = null;
  for (;;) {
    const page = readMirrorPage(mirror.request('page', { sort, descending, after, limit }));
    if (!page) throw new Error('页答复不合格');
    out.push(...page.rows.map((row) => row.handle));
    if (!page.next) return out;
    after = page.next;
  }
}

const stem = (handle: string) => /\\([^\\]+)\.flac$/.exec(handle)?.[1] ?? handle;

function status(mirror: Mirror) {
  return readMirrorStatus(mirror.request('status', {}));
}

describe('媒体库镜像：整库重建', () => {
  it('收尾之前不可读，收尾后状态带上纪元与修订号', async () => {
    const mirror = open(await directory());
    expect(status(mirror)).toMatchObject({ ready: false, epoch: '', revision: 0, count: 0 });
    const begun = mirror.request('rebuild-begin', {}) as { generation: number };
    mirror.request('rebuild-put', {
      generation: begun.generation,
      rows: [track('a'), track('b')],
      indexFrom: 0,
    });
    expect(() =>
      mirror.request('page', { sort: 'title', descending: false, after: null, limit: 5 }),
    ).toThrow('镜像还没有建好');
    mirror.request('rebuild-commit', { generation: begun.generation, epoch: 'E7', revision: 42 });
    expect(status(mirror)).toEqual({
      schema: 1,
      epoch: 'E7',
      revision: 42,
      count: 2,
      ready: true,
      bytes: expect.any(Number),
    });
  });

  it('再次重建后，上一轮有而这一轮没有的曲目被清掉', async () => {
    const mirror = open(await directory());
    rebuild(mirror, [track('a'), track('b'), track('c')]);
    rebuild(mirror, [track('b'), track('d')], 'E2', 5);
    expect(titles(mirror, 'title')).toEqual(['D:\\music\\b.flac', 'D:\\music\\d.flac']);
    expect(status(mirror)).toMatchObject({ epoch: 'E2', revision: 5, count: 2 });
  });

  it('过期代次的写入与收尾被拒绝，旧的一轮不会被它弄乱', async () => {
    const mirror = open(await directory());
    const first = mirror.request('rebuild-begin', {}) as { generation: number };
    const second = mirror.request('rebuild-begin', {}) as { generation: number };
    expect(() =>
      mirror.request('rebuild-put', { generation: first.generation, rows: [], indexFrom: 0 }),
    ).toThrow('代次已过期');
    expect(() =>
      mirror.request('rebuild-commit', { generation: first.generation, epoch: 'E', revision: 1 }),
    ).toThrow('代次已过期');
    mirror.request('rebuild-commit', { generation: second.generation, epoch: 'E', revision: 1 });
    expect(status(mirror)?.ready).toBe(true);
  });

  it('中途放弃的重建不影响下一次：库序按这一轮给的行号', async () => {
    const mirror = open(await directory());
    const abandoned = mirror.request('rebuild-begin', {}) as { generation: number };
    mirror.request('rebuild-put', {
      generation: abandoned.generation,
      rows: [track('x')],
      indexFrom: 0,
    });
    rebuild(mirror, [track('a'), track('b')]);
    const page = readMirrorPage(
      mirror.request('page', { sort: 'title', descending: false, after: null, limit: 5 }),
    );
    expect(page?.rows.map((row) => [row.title, row.index])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});

describe('媒体库镜像：按列翻页', () => {
  it('升序翻页不重不漏，降序恰是升序反过来，同值按库序', async () => {
    const mirror = open(await directory());
    const tracks = Array.from({ length: 23 }, (_, i) =>
      track(`t${String(i)}`, { title: `Song ${String(i % 5)}` }),
    );
    rebuild(mirror, tracks);
    for (const sort of MIRROR_SORT_COLUMNS) {
      const ascending = titles(mirror, sort);
      expect(new Set(ascending).size).toBe(23);
      expect(titles(mirror, sort, true)).toEqual([...ascending].reverse());
    }
    const byTitle = titles(mirror, 'title').map((handle) =>
      tracks.findIndex((t) => t.handle === handle),
    );
    const sameTitle = byTitle.slice(0, 5);
    expect(sameTitle).toEqual([...sameTitle].sort((a, b) => a - b));
  });

  it('标题按自然顺序、不分大小写，数字按数值，缺标题的按文件名', async () => {
    const mirror = open(await directory());
    rebuild(mirror, [
      track('x1', { title: 'track 10' }),
      track('x2', { title: 'Track 9' }),
      track('x3', { title: 'apple' }),
      track('zzz', { title: '' }),
    ]);
    const page = readMirrorPage(
      mirror.request('page', { sort: 'title', descending: false, after: null, limit: 10 }),
    );
    expect(page?.rows.map((row) => stem(row.handle))).toEqual(['x3', 'x2', 'x1', 'zzz']);
  });

  it('专辑列：专辑内按碟号、曲号；没有专辑的曲目日期按 9999 排到最后', async () => {
    const mirror = open(await directory());
    rebuild(mirror, [
      track('a2', { album: 'A', trackNumber: 2 }),
      track('a1', { album: 'A', trackNumber: 1 }),
      track('b', { album: 'B' }),
    ]);
    expect(titles(mirror, 'album').map(stem)).toEqual(['a1', 'a2', 'b']);
    rebuild(
      mirror,
      [track('late', { album: '', date: '1999' }), track('early', { album: 'E', date: '2020' })],
      'E1',
      2,
    );
    expect(titles(mirror, 'albumArtist').map(stem)).toEqual(['early', 'late']);
  });

  it('只取次序：各列的句柄次序与整行翻页相同，跨页接得上，路径与 subsong 按需带上', async () => {
    const mirror = open(await directory());
    const tracks = Array.from({ length: 23 }, (_, i) =>
      track(`t${String(i)}`, { title: `Song ${String(i % 5)}`, subsong: i % 3 }),
    );
    rebuild(mirror, tracks);
    const walk = (sort: MirrorSortColumn, paths: boolean) => {
      const out = { handles: [] as string[], paths: [] as string[], subsongs: [] as number[] };
      let after: string | null = null;
      for (;;) {
        const reply = readMirrorOrder(
          mirror.request('order', { sort, descending: false, after, limit: 7, paths }),
          paths,
        );
        if (!reply) throw new Error('次序答复不合格');
        out.handles.push(...reply.handles);
        out.paths.push(...reply.paths);
        out.subsongs.push(...reply.subsongs);
        if (!reply.next) return out;
        after = reply.next;
      }
    };
    for (const sort of MIRROR_SORT_COLUMNS) {
      expect(walk(sort, false).handles).toEqual(titles(mirror, sort));
    }
    const full = walk('title', true);
    const byHandle = (handle: string) => tracks.find((t) => t.handle === handle);
    expect(full.paths).toEqual(full.handles.map((handle) => byHandle(handle)?.path));
    expect(full.subsongs).toEqual(full.handles.map((handle) => byHandle(handle)?.subsong));
    expect(walk('title', false)).toMatchObject({ paths: [], subsongs: [] });
  });

  it('游标不合格时拒收；单页行数被夹在上限内', async () => {
    const mirror = open(await directory());
    rebuild(mirror, [track('a')]);
    expect(() =>
      mirror.request('page', { sort: 'title', descending: false, after: '[1]', limit: 5 }),
    ).toThrow('游标无效');
    expect(() =>
      mirror.request('page', { sort: 'nope', descending: false, after: null, limit: 5 }),
    ).toThrow('排序无效');
    const page = readMirrorPage(
      mirror.request('page', { sort: 'title', descending: false, after: null, limit: 99999 }),
    );
    expect(page).toMatchObject({ next: null, total: 1 });
  });
});

describe('媒体库镜像：增量', () => {
  it('纪元或修订号对不上时不写，答 stale', async () => {
    const mirror = open(await directory());
    expect(
      readMirrorApply(
        mirror.request('apply', { epoch: 'E1', since: 0, revision: 1, upsert: [], remove: [] }),
      ),
    ).toEqual({ stale: true });
    rebuild(mirror, [track('a')], 'E1', 5);
    const apply = (epoch: string, since: number) =>
      readMirrorApply(
        mirror.request('apply', { epoch, since, revision: 6, upsert: [track('b')], remove: [] }),
      );
    expect(apply('E2', 5)).toEqual({ stale: true });
    expect(apply('E1', 4)).toEqual({ stale: true });
    expect(status(mirror)).toMatchObject({ revision: 5, count: 1 });
    expect(apply('E1', 5)).toEqual({ stale: false, count: 2 });
    expect(status(mirror)).toMatchObject({ revision: 6, count: 2 });
  });

  it('改标题、删曲目、加曲目后，列表次序就是新的', async () => {
    const mirror = open(await directory());
    rebuild(mirror, [
      track('a', { title: 'Alpha' }),
      track('b', { title: 'Beta' }),
      track('c', { title: 'Gamma' }),
    ]);
    mirror.request('apply', {
      epoch: 'E1',
      since: 1,
      revision: 2,
      upsert: [track('a', { title: 'Zulu' }), track('d', { title: 'Beta2' })],
      remove: [track('c').handle],
    });
    const page = readMirrorPage(
      mirror.request('page', { sort: 'title', descending: false, after: null, limit: 10 }),
    );
    expect(page?.rows.map((row) => row.title)).toEqual(['Beta', 'Beta2', 'Zulu']);
  });

  it('改一首曲目不挪它的库序', async () => {
    const mirror = open(await directory());
    rebuild(mirror, [track('a'), track('b')]);
    mirror.request('apply', {
      epoch: 'E1',
      since: 1,
      revision: 2,
      upsert: [track('a', { title: 'Renamed' }), track('c')],
      remove: [],
    });
    const rows = readMirrorPage(
      mirror.request('page', { sort: 'path', descending: false, after: null, limit: 10 }),
    )?.rows;
    expect(rows?.map((row) => stem(row.handle))).toEqual(['a', 'b', 'c']);
    expect(rows?.[0]?.index).toBe(0);
    expect(rows?.[1]?.index).toBe(1);
    expect(rows?.[2]?.index).toBeGreaterThan(1);
  });

  it('增量写入的次序与同一份数据整库重建的次序一致', async () => {
    const words = [
      'alpha',
      'Alpha',
      'beta',
      'Beta 2',
      'beta 10',
      'gamma',
      'Delta',
      'delta',
      '',
      'épsilon',
      'zeta',
      'Zeta 1',
      '日本',
      'ABC',
    ];
    let seed = 7;
    const pick = <T>(list: readonly T[]): T => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return list[seed % list.length] as T;
    };
    const all = Array.from({ length: 120 }, (_, i) =>
      track(`n${String(i)}`, {
        title: pick(words),
        artist: pick(words),
        artists: [pick(words)],
        album: pick(['', 'Album A', 'album b', 'Album 10', 'Album 9']),
        albumArtist: pick(words),
        albumArtists: [pick(words)],
        genre: pick(['Rock', 'rock', 'Jazz', '']),
        date: pick(['2001', '1999', '', '2001-05']),
        codec: pick(['FLAC', 'MP3', 'flac']),
        trackNumber: seed % 12,
        discNumber: seed % 3,
        duration: seed % 400,
        bitrate: pick([128, 320, 900]),
        rating: seed % 6,
        fileSize: seed * 7,
        sampleRate: pick([44100, 48000]),
        channels: pick([1, 2]),
      }),
    );
    const incremental = open(await directory());
    rebuild(incremental, all.slice(0, 40));
    let revision = 1;
    for (let at = 40; at < all.length; at += 10) {
      incremental.request('apply', {
        epoch: 'E1',
        since: revision,
        revision: revision + 1,
        upsert: all.slice(at, at + 10),
        remove: [],
      });
      revision += 1;
    }
    const whole = open(await directory());
    rebuild(whole, all);
    for (const sort of MIRROR_SORT_COLUMNS) {
      expect(titles(incremental, sort), sort).toEqual(titles(whole, sort));
    }
  });

  it('同一处空档里连续塞很多新值，空档用尽后整体重排，次序仍然正确', async () => {
    const mirror = open(await directory());
    rebuild(mirror, [track('lo', { title: 'A' }), track('hi', { title: 'B' })]);
    let revision = 1;
    const added: MirrorTrack[] = [];
    for (let i = 0; i < 45; i++) {
      const next = track(`mid${String(i)}`, { title: `A${'z'.repeat(i + 1)}` });
      added.push(next);
      mirror.request('apply', {
        epoch: 'E1',
        since: revision,
        revision: revision + 1,
        upsert: [next],
        remove: [],
      });
      revision += 1;
    }
    const expected = ['lo', ...added.map((t) => t.title).map((_, i) => `mid${String(i)}`), 'hi'];
    expect(titles(mirror, 'title').map((handle) => /\\([^\\]+)\.flac$/.exec(handle)?.[1])).toEqual(
      expected,
    );
  });

  it('请求体里的行不合格时整批拒收', async () => {
    const mirror = open(await directory());
    rebuild(mirror, [track('a')]);
    expect(() =>
      mirror.request('apply', {
        epoch: 'E1',
        since: 1,
        revision: 2,
        upsert: [{ handle: 'x' }],
        remove: [],
      }),
    ).toThrow('曲目行无效');
    expect(status(mirror)).toMatchObject({ revision: 1, count: 1 });
  });
});

describe('媒体库镜像：分组清单', () => {
  const tracks = [
    track('1', {
      album: 'A',
      albumArtist: 'X',
      albumArtists: ['X'],
      artist: 'X',
      artists: ['X'],
      genre: '',
      date: '',
      duration: 100,
      discNumber: 0,
    }),
    track('2', {
      album: 'A',
      albumArtist: 'X',
      albumArtists: ['X'],
      artist: 'X, Y',
      artists: ['X', 'Y'],
      genre: 'Pop, Rock',
      date: '2019-05-01',
      duration: 50,
      discNumber: 2,
    }),
    track('3', {
      album: 'A',
      albumArtist: '',
      albumArtists: [],
      artist: 'Z',
      artists: ['Z'],
      duration: 10,
    }),
    track('4', {
      album: '',
      albumArtist: '',
      albumArtists: [],
      artist: 'Y',
      artists: ['Y'],
      duration: 5,
    }),
    track('5', {
      album: 'B',
      albumId: 'opaque-1',
      artist: 'Y',
      artists: ['Y'],
      albumArtist: 'Y',
      albumArtists: ['Y'],
    }),
  ];

  it('专辑按（专辑名，专辑艺人）分组；年份与流派取各曲中第一个非空值，流派取其第一个值', async () => {
    const mirror = open(await directory());
    rebuild(mirror, tracks);
    const albums = readMirrorAlbums(mirror.request('albums', {}));
    expect(albums).toHaveLength(3);
    const a = albums?.find((album) => album.name === 'A' && album.albumArtist === 'X');
    expect(a).toMatchObject({
      trackCount: 2,
      discCount: 1,
      duration: 150,
      year: '2019-05-01',
      genre: 'Pop',
      firstTrackAbsolutePath: tracks[0]?.absolutePath,
    });
    expect(
      albums?.find((album) => album.name === 'A' && album.albumArtist === 'Z')?.trackCount,
    ).toBe(1);
    expect(albums?.find((album) => album.albumId === 'opaque-1')).toMatchObject({ name: 'B' });
  });

  it('艺人按每个署名值一行，数曲数、时长、专辑名；参与的专辑可与专辑清单对上', async () => {
    const mirror = open(await directory());
    rebuild(mirror, tracks);
    const artists = readMirrorArtists(mirror.request('artists', {}));
    const y = artists?.find((artist) => artist.name === 'Y');
    expect(y).toMatchObject({ trackCount: 3, albumCount: 2, totalDuration: 50 + 5 + 180.4 });
    expect(y?.albums).toEqual([
      { name: 'A', artist: 'X' },
      { albumId: 'opaque-1', name: 'B', artist: 'Y' },
    ]);
    expect(artists?.map((artist) => artist.name)).toEqual(['X', 'Y', 'Z']);
  });
});

describe('媒体库镜像：持久与清空', () => {
  it('重启后镜像还在，纪元与修订号可续', async () => {
    const path = await directory();
    const first = startLibraryMirror(path);
    rebuild(first, [track('a'), track('b')], 'E9', 77);
    first.dispose();
    const mirror = open(path);
    expect(status(mirror)).toMatchObject({ ready: true, epoch: 'E9', revision: 77, count: 2 });
    expect(titles(mirror, 'title')).toHaveLength(2);
    expect(
      readMirrorApply(
        mirror.request('apply', {
          epoch: 'E9',
          since: 77,
          revision: 78,
          upsert: [track('c')],
          remove: [],
        }),
      ),
    ).toEqual({ stale: false, count: 3 });
  });

  const CURRENT_LOCALE = new Intl.Collator().resolvedOptions().locale;
  it.each([
    ['区域', 'xx-XX'],
    ['ICU 版本', `${CURRENT_LOCALE}|icu 0.0|cldr ${String(process.versions.cldr)}`],
    ['记录的是旧格式（只有区域）', CURRENT_LOCALE],
  ])('比较器的%s与建库时不同，重启后丢掉旧镜像等页面重建', async (_name, recorded) => {
    const path = await directory();
    const first = startLibraryMirror(path);
    rebuild(first, [track('a'), track('b')], 'E9', 77);
    first.dispose();
    const file = new DatabaseSync(
      join(path, `library-mirror.v${String(LIBRARY_MIRROR_SCHEMA)}.sqlite`),
    );
    file.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('collation', ?)").run(recorded);
    file.close();
    const mirror = open(path);
    expect(status(mirror)).toMatchObject({ ready: false, epoch: '', revision: 0, count: 0 });
    rebuild(mirror, [track('c')], 'E1', 1);
    expect(titles(mirror, 'title')).toEqual([track('c').handle]);
  });

  it('状态报磁盘占用；整库重建收尾后预写日志被截断，占用就是数据库文件的大小', async () => {
    const path = await directory();
    const mirror = open(path);
    expect(status(mirror)?.bytes).toBeGreaterThan(0);
    rebuild(
      mirror,
      Array.from({ length: 200 }, (_, i) => track(`t${String(i)}`)),
    );
    const file = join(path, `library-mirror.v${String(LIBRARY_MIRROR_SCHEMA)}.sqlite`);
    expect(statSync(`${file}-wal`).size).toBe(0);
    expect(status(mirror)?.bytes).toBe(statSync(file).size);
  });

  it('清空后不可读，库序与秩从头来', async () => {
    const mirror = open(await directory());
    rebuild(mirror, [track('a')]);
    expect(mirror.request('clear', {})).toEqual({ success: true });
    expect(status(mirror)).toMatchObject({ ready: false, epoch: '', revision: 0, count: 0 });
    rebuild(mirror, [track('b', { title: 'Q' })], 'E2', 3);
    expect(titles(mirror, 'title')).toEqual([track('b').handle]);
  });

  it('按句柄取行，按请求次序给，没有的跳过', async () => {
    const mirror = open(await directory());
    rebuild(mirror, [track('a'), track('b'), track('c')]);
    const reply = mirror.request('rows', {
      handles: [track('c').handle, 'missing', track('a').handle],
    });
    const rows = (reply as { rows: { title: string }[] }).rows;
    expect(rows.map((row) => row.title)).toEqual(['c', 'a']);
  });
});
