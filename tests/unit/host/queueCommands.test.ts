import { describe, expect, it, vi } from 'vitest';
import { enqueuePaths, playKeepingQueue, QUEUE_BATCH } from '../../../src/host/queueCommands.ts';
import { makePlaylist } from '../../fixtures/fakePlaylists.ts';
import { installFakeQueue, queueTracks } from '../../fixtures/fakeQueue.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const GUID = '{22222222-2222-2222-2222-222222222222}';

describe('enqueuePaths', () => {
  it('等队尾长度期间取消，不再写入；首批之后取消，不发送后续批次', async () => {
    const host = installFakeHost();
    installFakeQueue(host);
    let active = true;
    const held = host.hold('queue.getCount');
    const pending = enqueuePaths(host.fb, ['a'], 'last', () => active);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    active = false;
    held.release();
    expect(await pending).toBe(false);
    expect(host.callsTo('queue.insertNext')).toEqual([]);
    active = true;
    host.answer('queue.insertNext', () => {
      active = false;
      return {
        success: true,
        insertedCount: QUEUE_BATCH,
        movedCount: 0,
        invalidCount: 0,
        queueCount: QUEUE_BATCH,
      };
    });
    expect(
      await enqueuePaths(
        host.fb,
        Array.from({ length: QUEUE_BATCH + 1 }, (_, i) => String(i)),
        'next',
        () => active,
      ),
    ).toBe(false);
    expect(host.callsTo('queue.insertNext')).toHaveLength(1);
  });

  it('宿主部分路径解析失败，报告失败且不发送后续批次', async () => {
    const host = installFakeHost();
    host.answer('queue.insertNext', {
      success: true,
      insertedCount: 255,
      movedCount: 0,
      invalidCount: 1,
      queueCount: 255,
    });
    expect(
      await enqueuePaths(
        host.fb,
        Array.from({ length: QUEUE_BATCH + 1 }, (_, i) => String(i)),
        'next',
      ),
    ).toBe(false);
    expect(host.callsTo('queue.insertNext')).toHaveLength(1);
  });
  it('下一首播放插在队首，加入队列接在队尾；已在队列里的挪过来', async () => {
    const host = installFakeHost();
    const [a, b, c] = queueTracks('a', 'b', 'c');
    if (!a || !b || !c) throw new Error('缺曲目');
    const queue = installFakeQueue(host, [a, b], [c]);
    expect(await enqueuePaths(host.fb, [c.handle], 'next')).toBe(true);
    expect(queue.titles()).toEqual(['c', 'a', 'b']);
    expect(await enqueuePaths(host.fb, [a.handle], 'last')).toBe(true);
    expect(queue.titles()).toEqual(['c', 'b', 'a']);
  });

  it('分批送，后一批接在前一批落下的位置之后', async () => {
    const host = installFakeHost();
    installFakeQueue(host);
    const paths = Array.from({ length: QUEUE_BATCH + 3 }, (_, at) => `E:/Music/${at}.flac`);
    expect(await enqueuePaths(host.fb, paths, 'next')).toBe(true);
    const calls = host.callsTo('queue.insertNext');
    expect(calls.map((call) => call['position'])).toEqual([0, QUEUE_BATCH]);
  });

  it('什么都没给不发', async () => {
    const host = installFakeHost();
    expect(await enqueuePaths(host.fb, [], 'next')).toBe(false);
    expect(host.callsTo('queue.insertNext')).toEqual([]);
  });
});

describe('playKeepingQueue', () => {
  it.each([
    { invalidCount: 1, insertedCount: 0, movedCount: 0 },
    { invalidCount: 0, insertedCount: 0, movedCount: 0 },
  ])('目标没有成功入队时不误播原队首：%o', async (counts) => {
    const host = installFakeHost();
    const queue = installFakeQueue(host, queueTracks('原队首'));
    host.answer('playlist.getAll', {
      success: true,
      count: 1,
      playlists: [makePlaylist(0, 'Target', { guid: GUID, trackCount: 2 })],
    });
    host.answer('queue.insertNext', { success: true, ...counts, queueCount: 1 });
    expect(await playKeepingQueue(host.fb, GUID, 1)).toBe(false);
    expect(host.callsTo('queue.insertNext')).toHaveLength(1);
    expect(host.callsTo('queue.playNow')).toEqual([]);
    expect(host.callsTo('playlist.playTrack')).toEqual([]);
    expect(queue.titles()).toEqual(['原队首']);
  });

  it('读取队列长度期间取消，不执行默认播放或插队', async () => {
    const host = installFakeHost();
    installFakeQueue(host, queueTracks('a'));
    let active = true;
    const held = host.hold('queue.getCount');
    const pending = playKeepingQueue(host.fb, GUID, 0, undefined, () => active);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    active = false;
    held.release();
    expect(await pending).toBe(false);
    expect(host.callsTo('playlist.playTrack')).toEqual([]);
    expect(host.callsTo('queue.insertNext')).toEqual([]);
  });
  it('队列为空时照旧走宿主的缺省起播', async () => {
    const host = installFakeHost();
    installFakeQueue(host);
    expect(await playKeepingQueue(host.fb, GUID, 4)).toBe(true);
    expect(host.callsTo('playlist.playTrack')).toHaveLength(1);
    expect(host.callsTo('queue.playNow')).toEqual([]);
  });

  it('队列不为空：按 GUID 现查序号，坐标插到队首再只取走它，留着的队列不动', async () => {
    const host = installFakeHost({
      answers: {
        playlist: {
          getAll: {
            success: true,
            count: 2,
            playlists: [
              {
                index: 0,
                guid: '{other}',
                name: 'Other',
                trackCount: 1,
                isActive: false,
                isPlaying: false,
                isLocked: false,
                isAutoplaylist: false,
              },
              {
                index: 1,
                guid: GUID,
                name: 'Target',
                trackCount: 9,
                isActive: true,
                isPlaying: false,
                isLocked: false,
                isAutoplaylist: false,
              },
            ],
          },
        },
      },
    });
    const queue = installFakeQueue(host, queueTracks('a', 'b'));
    expect(await playKeepingQueue(host.fb, GUID, 4)).toBe(true);
    expect(host.callsTo('playlist.playTrack')).toEqual([]);
    expect(host.callsTo('queue.insertNext')[0]).toMatchObject({
      items: [{ playlist: 1, item: 4 }],
      position: 0,
    });
    expect(queue.titles()).toEqual(['a', 'b']);
  });

  it('给了那一行当时的句柄：这一行已换成另一首时不起播', async () => {
    const host = installFakeHost({
      answers: {
        playlist: {
          getAll: {
            success: true,
            count: 1,
            playlists: [
              {
                index: 0,
                guid: GUID,
                name: 'Target',
                trackCount: 9,
                isActive: true,
                isPlaying: false,
                isLocked: false,
                isAutoplaylist: false,
              },
            ],
          },
          getTracks: {
            success: true,
            playlist: 0,
            start: 4,
            count: 1,
            total: 9,
            tracks: [makeTrack({ path: 'file://E:/Music/other.flac' })],
          },
        },
      },
    });
    installFakeQueue(host, queueTracks('a'));
    expect(await playKeepingQueue(host.fb, GUID, 4, 'E:/Music/expected.flac')).toBe(false);
    expect(host.callsTo('queue.insertNext')).toEqual([]);
    expect(host.callsTo('queue.playNow')).toEqual([]);
  });

  it('宿主不在：答 false，不抛错', async () => {
    const host = installFakeHost({ available: false });
    expect(await enqueuePaths(host.fb, ['E:/Music/a.flac'], 'last')).toBe(false);
    expect(await playKeepingQueue(host.fb, GUID, 0)).toBe(false);
  });
});
