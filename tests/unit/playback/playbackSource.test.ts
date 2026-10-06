import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { LIBRARY_VIEW_PLAYLIST } from '../../../src/playback/libraryView.ts';
import {
  playbackSourceAtom,
  sourceHome,
  sourceLabel,
  type PlaybackSource,
  startPlaybackSource,
  type RecordedSource,
} from '../../../src/playback/playbackSource.ts';
import { createConfigWriter } from '../../../src/host/configWrite.ts';
import type { DataWriter } from '../../../src/kit/dataWrite.ts';
import { createMemoryDataWriter, occupyWriteLock } from '../../fixtures/dataWriter.ts';
import type { HostResponse } from '../../fixtures/fakeHost.ts';
import { hostFailure, type ConfigValue } from '../../fixtures/hostAnswers.ts';
import { guidOf } from '../../fixtures/fakePlaylists.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const KEY = 'defaultTheme.playback.source';
const MODAL_SOUL: RecordedSource = {
  kind: 'album',
  subject: 'Modal Soul\0Nujabes',
  name: 'Modal Soul',
};
const LIBRARY_VIEW = guidOf(7);
const CHILL = guidOf(1);
const NIGHT = guidOf(2);

/** `playlist.getPlaying` 答第 `guid` 张在播，名字照给；不给 guid 时是没有在播的表。 */
function playing(guid?: string, name = ''): HostResponse<'playlist.getPlaying'> {
  if (guid === undefined) return { success: true, found: false };
  return { success: true, found: true, index: 0, guid, name, trackCount: 10, isActive: false };
}
const LIBRARY_VIEW_PLAYING = playing(LIBRARY_VIEW, LIBRARY_VIEW_PLAYLIST);

const writers = new WeakMap<UnitHost, DataWriter>();

function writerFor(host: UnitHost, data = createMemoryDataWriter()) {
  writers.set(host, data.writer);
  return createConfigWriter(host.fb, data.writer);
}

/** 写锁先来先得：排到这次时，之前发起的写入都已执行完。 */
async function written(host: UnitHost): Promise<void> {
  await writers.get(host)?.run(() => undefined);
}

async function start(host: UnitHost, data = createMemoryDataWriter()) {
  const store = createStore();
  const service = startPlaybackSource(store, host.fb, writerFor(host, data));
  onTestFinished(() => service.dispose());
  await service.ready;
  await settle();
  return {
    store,
    service,
    data,
    source: () => store.get(playbackSourceAtom),
    saveState: () => store.get(service.saveState),
  };
}

/** 宿主自己起播或换曲：先 starting 再 trackChanged。 */
function hostStarts(host: UnitHost): void {
  host.emit('playback:starting', { command: 'play', paused: false });
  host.emit('playback:trackChanged', makeTrack());
}

describe('startPlaybackSource', () => {
  it('记下主题起播的来源，立即生效并落盘', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: playing() } } });
    const { service, source } = await start(host);
    expect(source()).toBeNull();
    service.record(MODAL_SOUL);
    expect(source()).toEqual(MODAL_SOUL);
    await settle();
    await written(host);
    expect(host.config.get(KEY)).toEqual(MODAL_SOUL);
  });

  it('换曲不改来源：专用列表接着往下放，来源还是那张专辑', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: LIBRARY_VIEW_PLAYING } } });
    const { service, source } = await start(host);
    service.record(MODAL_SOUL);
    host.emit('playback:trackChanged', makeTrack({ title: 'Luv (sic) Part 3' }));
    await settle();
    expect(source()).toEqual(MODAL_SOUL);
  });

  it('歌曲页起播：主体是查询、名字可以是空串；在播专用列表时照旧，家是歌曲页', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: LIBRARY_VIEW_PLAYING } } });
    const { service, source } = await start(host);
    const songs: RecordedSource = { kind: 'songs', subject: 'ALL', name: '' };
    service.record(songs);
    hostStarts(host);
    await settle();
    expect(source()).toEqual(songs);
    await written(host);
    expect(host.config.get(KEY)).toEqual(songs);
    expect(sourceHome(songs)).toEqual({ id: 'songs' });
  });

  it('流派来源可落盘与读回，专用列表换曲仍保留，家是选中该流派的流派页', async () => {
    const genre: RecordedSource = { kind: 'genre', subject: 'Hip-Hop', name: 'Hip-Hop' };
    const host = installFakeHost({
      config: { [KEY]: genre },
      answers: { playlist: { getPlaying: LIBRARY_VIEW_PLAYING } },
    });
    const { service, source } = await start(host);
    expect(source()).toEqual(genre);
    const next: RecordedSource = { kind: 'genre', subject: 'Jazz', name: 'Jazz' };
    service.record(next);
    hostStarts(host);
    await settle();
    expect(source()).toEqual(next);
    await written(host);
    expect(host.config.get(KEY)).toEqual(next);
    expect(sourceHome(next)).toEqual({ id: 'genres', subject: 'Jazz' });
    service.dispose();
  });

  it('宿主菜单起播了另一张表：来源退回那张列表', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: LIBRARY_VIEW_PLAYING } } });
    const { service, source } = await start(host);
    service.record(MODAL_SOUL);
    host.answer('playlist.getPlaying', playing(CHILL, 'Chill'));
    hostStarts(host);
    await settle();
    expect(source()).toEqual({ kind: 'playlist', subject: CHILL, name: 'Chill' });
    await written(host);
    expect(host.config.get(KEY)).toEqual({ kind: 'playlist', subject: CHILL, name: 'Chill' });
  });

  it('在播的是专用列表而主题没有记录：媒体库；来源是别的列表时同样写媒体库', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: LIBRARY_VIEW_PLAYING } } });
    const { service, source } = await start(host);
    expect(source()).toEqual({ kind: 'library' });
    service.record({ kind: 'playlist', subject: NIGHT, name: 'Night' });
    hostStarts(host);
    await settle();
    expect(source()).toEqual({ kind: 'library' });
    expect(sourceHome({ kind: 'library' })).toEqual({ id: 'albums' });
  });

  it('宿主答没有在播的表（停止之后）不改来源', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: playing() } } });
    const { service, source } = await start(host);
    service.record({ kind: 'playlist', subject: CHILL, name: 'Chill' });
    hostStarts(host);
    await settle();
    expect(source()).toEqual({ kind: 'playlist', subject: CHILL, name: 'Chill' });
  });

  it('主题从专用列表起播，照宿主的事件顺序：record 之后紧跟的换曲不冲掉刚记下的专辑', async () => {
    const host = installFakeHost({
      answers: { playlist: { getPlaying: playing(CHILL, 'Chill') } },
    });
    const { service, source } = await start(host);
    expect(source()).toEqual({ kind: 'playlist', subject: CHILL, name: 'Chill' });
    const reads = host.hold('playlist.getPlaying');
    // 正在放 Chill 时主题调 playTrack：宿主切到专用列表，先报停止与 starting，这几条先于 playTrack 的应答到。
    host.answer('playlist.getPlaying', LIBRARY_VIEW_PLAYING);
    host.emit('playback:stopped', { reason: 'user' });
    host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state: 'stopped',
      position: 0,
      duration: 0,
      canSeek: false,
    });
    host.emit('playback:starting', { command: 'play', paused: false });
    await settle();
    // playTrack 答了成功，调用方记下来源；新曲目打开后宿主才报 trackChanged 与带 canSeek 的 stateChanged。
    service.record(MODAL_SOUL);
    host.emit('playback:trackChanged', makeTrack({ title: 'Feather' }));
    host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state: 'playing',
      position: 0,
      duration: 175,
      canSeek: true,
    });
    await settle();
    expect(reads.pending).toHaveLength(2);
    reads.release();
    await settle();
    expect(source()).toEqual(MODAL_SOUL);
    await written(host);
    expect(host.config.get(KEY)).toEqual(MODAL_SOUL);
  });

  it('record 之前发出、之后才答的核对作废：它读到的可能是起播之前在播的那张', async () => {
    const host = installFakeHost({
      answers: { playlist: { getPlaying: playing(CHILL, 'Chill') } },
    });
    const { service, source } = await start(host);
    const reads = host.hold('playlist.getPlaying');
    host.emit('playback:trackChanged', makeTrack({ title: 'Next in Chill' }));
    await settle();
    service.record(MODAL_SOUL);
    reads.respond(0, playing(CHILL, 'Chill'));
    await settle();
    expect(source()).toEqual(MODAL_SOUL);
  });

  it('跨重启：读回存档；读回之后才按在播的表核对，存档里的专辑不被当成没有记录', async () => {
    const host = installFakeHost({
      config: { [KEY]: MODAL_SOUL },
      answers: { playlist: { getPlaying: LIBRARY_VIEW_PLAYING } },
    });
    const restore = host.hold('config.get');
    const store = createStore();
    const service = startPlaybackSource(store, host.fb, writerFor(host));
    await settle();
    host.emit('playback:trackChanged', makeTrack());
    await settle();
    restore.release();
    await service.ready;
    await settle();
    expect(store.get(playbackSourceAtom)).toEqual(MODAL_SOUL);
    expect(sourceHome(MODAL_SOUL)).toEqual({ id: 'album', subject: 'Modal Soul\0Nujabes' });
  });

  it('存档读回途中已经 record 过：晚到的旧存档不覆盖', async () => {
    const stored: ConfigValue = { kind: 'playlist', subject: NIGHT, name: 'Night' };
    const host = installFakeHost({
      config: { [KEY]: stored },
      answers: { playlist: { getPlaying: LIBRARY_VIEW_PLAYING } },
    });
    const restore = host.hold('config.get');
    const store = createStore();
    const service = startPlaybackSource(store, host.fb, writerFor(host));
    await settle();
    service.record(MODAL_SOUL);
    restore.respond(0, { success: true, key: KEY, value: stored, found: true });
    await service.ready;
    await settle();
    expect(store.get(playbackSourceAtom)).toEqual(MODAL_SOUL);
    await written(host);
    expect(host.config.get(KEY)).toEqual(MODAL_SOUL);
  });

  it('存档没读成：核对只改显示、不落盘，存着的专辑留给下次；之后 record 照常落盘', async () => {
    const host = installFakeHost({
      config: { [KEY]: MODAL_SOUL },
      answers: {
        config: { get: hostFailure('OPERATION_FAILED') },
        playlist: { getPlaying: LIBRARY_VIEW_PLAYING },
      },
    });
    const { service, source, saveState } = await start(host);
    expect(source()).toEqual({ kind: 'library' });
    await written(host);
    expect(host.config.get(KEY)).toEqual(MODAL_SOUL);
    expect(saveState()).toEqual({ status: 'idle' });
    const night: RecordedSource = { kind: 'playlist', subject: NIGHT, name: 'Night' };
    service.record(night);
    await settle();
    await written(host);
    expect(host.config.get(KEY)).toEqual(night);
  });

  it.each<[string, ConfigValue]>([
    ['不是对象', 'album'],
    ['种类不认得', { kind: 'unsupported', subject: 'Nujabes', name: 'Nujabes' }],
    ['主体是空串', { kind: 'album', subject: '', name: 'Modal Soul' }],
    ['缺名字', { kind: 'playlist', subject: CHILL }],
    ['数组', [MODAL_SOUL]],
  ])('存档是坏值（%s）当没有存', async (_, value) => {
    const host = installFakeHost({
      config: { [KEY]: value },
      answers: { playlist: { getPlaying: playing() } },
    });
    const { source } = await start(host);
    expect(source()).toBeNull();
  });

  it('存档里的媒体库与列表照原样读回', async () => {
    const host = installFakeHost({
      config: { [KEY]: { kind: 'playlist', subject: CHILL, name: 'Chill' } },
      answers: { playlist: { getPlaying: playing() } },
    });
    const { source } = await start(host);
    expect(source()).toEqual({ kind: 'playlist', subject: CHILL, name: 'Chill' });
    expect(sourceHome({ kind: 'playlist', subject: CHILL, name: 'Chill' })).toEqual({
      id: 'playlist',
      subject: CHILL,
    });
  });

  it('释放之后不再跟事件，晚到的核对与 record 都不写', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: playing() } } });
    const { service, source } = await start(host);
    service.record(MODAL_SOUL);
    const reads = host.hold('playlist.getPlaying');
    hostStarts(host);
    await settle();
    service.dispose();
    reads.respond(0, playing(CHILL, 'Chill'));
    reads.respond(0, playing(CHILL, 'Chill'));
    service.record({ kind: 'playlist', subject: NIGHT, name: 'Night' });
    await settle();
    expect(source()).toEqual(MODAL_SOUL);
    expect(host.listenerCount('playback:trackChanged')).toBe(0);
    expect(host.listenerCount('playback:starting')).toBe(0);
  });
});

describe('来源落盘', () => {
  it('落盘失败记在 saveState，来源照常显示；retry 重写当前来源', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: playing() } } });
    const { service, source, saveState } = await start(host);
    expect(await service.retry()).toBe(false);
    const held = host.hold('config.set');
    service.record(MODAL_SOUL);
    expect(saveState()).toEqual({ status: 'pending' });
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0, hostFailure('OPERATION_FAILED'));
    await vi.waitFor(() => expect(saveState()).toMatchObject({ status: 'failed' }));
    expect(source()).toEqual(MODAL_SOUL);
    held.release();
    expect(await service.retry()).toBe(true);
    expect(saveState()).toEqual({ status: 'saved', generation: 1 });
    expect(host.config.get(KEY)).toEqual(MODAL_SOUL);
  });

  it('连续 record 按发起顺序落盘，只有最新一次的结果进 saveState', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: playing() } } });
    const { service, saveState } = await start(host);
    const held = host.hold('config.set');
    const night: RecordedSource = { kind: 'playlist', subject: NIGHT, name: 'Night' };
    service.record(MODAL_SOUL);
    service.record(night);
    await vi.waitFor(() => expect(held.pending).toEqual([{ key: KEY, value: MODAL_SOUL }]));
    held.respond(0, hostFailure('OPERATION_FAILED'));
    await vi.waitFor(() => expect(held.pending).toEqual([{ key: KEY, value: night }]));
    expect(saveState()).toEqual({ status: 'pending' });
    held.respond(0);
    await vi.waitFor(() => expect(saveState()).toMatchObject({ status: 'saved' }));
    expect(host.config.get(KEY)).toEqual(night);
  });

  it('没有写入助手时 record 记为落盘失败，不直接写宿主', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: playing() } } });
    const store = createStore();
    const service = startPlaybackSource(store, host.fb);
    onTestFinished(() => service.dispose());
    await service.ready;
    service.record(MODAL_SOUL);
    await vi.waitFor(() =>
      expect(store.get(service.saveState)).toEqual({ status: 'failed', reason: 'unavailable' }),
    );
    expect(store.get(playbackSourceAtom)).toEqual(MODAL_SOUL);
    expect(host.callsTo('config.set')).toEqual([]);
  });

  it('释放时取消仍在等锁的写入', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: playing() } } });
    const { service, data } = await start(host);
    const release = await occupyWriteLock(data.writer);
    service.record(MODAL_SOUL);
    service.dispose();
    await release();
    await written(host);
    expect(data.values.size).toBe(0);
    expect(host.callsTo('config.set')).toEqual([]);
  });
});

describe('艺人播放来源', () => {
  it.each(['Nujabes', 'nujabes', '  Nujabes  ', ''])(
    '原样读回主体 %j 并返回对应艺人地点',
    async (subject) => {
      const artist: RecordedSource = { kind: 'artist', subject, name: subject || '没写艺术家' };
      const host = installFakeHost({
        config: { [KEY]: artist },
        answers: { playlist: { getPlaying: LIBRARY_VIEW_PLAYING } },
      });
      const { service, source } = await start(host);
      expect(source()).toEqual(artist);
      expect(sourceHome(artist)).toEqual({ id: 'artists', subject });
      await written(host);
      expect(host.config.get(KEY)).toEqual(artist);
      service.dispose();
    },
  );

  it.each(['Nujabes', 'nujabes', ''])('记下艺人 %j 后宿主换曲仍保留该来源', async (subject) => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: LIBRARY_VIEW_PLAYING } } });
    const { service, source } = await start(host);
    const artist: RecordedSource = { kind: 'artist', subject, name: subject || '没写艺术家' };
    service.record(artist);
    host.emit('playback:trackChanged', makeTrack({ artist: '另一位署名艺人' }));
    await settle();
    expect(source()).toEqual(artist);
    await written(host);
    expect(host.config.get(KEY)).toEqual(artist);
    service.dispose();
  });

  it('新艺人来源不被先前发出的播放列表读回覆盖', async () => {
    const host = installFakeHost({
      answers: { playlist: { getPlaying: playing(CHILL, 'Chill') } },
    });
    const { service, source } = await start(host);
    const reads = host.hold('playlist.getPlaying');
    host.emit('playback:trackChanged', makeTrack());
    await settle();
    const artist: RecordedSource = { kind: 'artist', subject: '', name: '没写艺术家' };
    service.record(artist);
    reads.respond(0, playing(CHILL, 'Chill'));
    await settle();
    expect(source()).toEqual(artist);
    await written(host);
    expect(host.config.get(KEY)).toEqual(artist);
    service.dispose();
  });

  it('离开专用列表后按真实在播列表更新来源', async () => {
    const host = installFakeHost({ answers: { playlist: { getPlaying: LIBRARY_VIEW_PLAYING } } });
    const { service, source } = await start(host);
    service.record({ kind: 'artist', subject: 'Nujabes', name: 'Nujabes' });
    host.answer('playlist.getPlaying', playing(CHILL, 'Chill'));
    hostStarts(host);
    await settle();
    expect(source()).toEqual({ kind: 'playlist', subject: CHILL, name: 'Chill' });
    service.dispose();
  });

  it.each(['album', 'playlist', 'songs', 'genre', 'folder'])(
    '其余来源 %s 的空主体仍无效',
    async (kind) => {
      const host = installFakeHost({
        config: { [KEY]: { kind, subject: '', name: '空主体' } },
        answers: { playlist: { getPlaying: playing() } },
      });
      const { service, source } = await start(host);
      expect(source()).toBeNull();
      service.dispose();
    },
  );
});

describe('来源文字', () => {
  const cases: readonly [PlaybackSource, string, string][] = [
    [
      { kind: 'album', subject: 'album-key', name: 'Modal Soul' },
      '专辑 · Modal Soul',
      'Album · Modal Soul',
    ],
    [{ kind: 'artist', subject: 'Nujabes', name: '显示名' }, '艺人 · 显示名', 'Artist · 显示名'],
    [
      { kind: 'artist', subject: '', name: '没写艺术家' },
      '艺人 · 没写艺术家',
      'Artist · 没写艺术家',
    ],
    [{ kind: 'playlist', subject: CHILL, name: 'Chill' }, '播放列表 · Chill', 'Playlist · Chill'],
    [{ kind: 'songs', subject: 'ALL', name: '' }, '歌曲', 'Songs'],
    [
      { kind: 'songs', subject: 'rating GREATER 3', name: '高评分' },
      '歌曲 · 高评分',
      'Songs · 高评分',
    ],
    [{ kind: 'genre', subject: 'Jazz', name: 'Jazz' }, '流派 · Jazz', 'Genre · Jazz'],
    [{ kind: 'folder', subject: 'folder-key', name: 'Music' }, '文件夹 · Music', 'Folder · Music'],
    [{ kind: 'library' }, '媒体库', 'Library'],
  ];

  it.each(cases)('%j 的中英文来源文字', (source, chinese, english) => {
    expect(sourceLabel(source, createTranslate(zhCN, {}))).toBe(chinese);
    expect(sourceLabel(source, createTranslate(en, {}))).toBe(english);
  });
});
