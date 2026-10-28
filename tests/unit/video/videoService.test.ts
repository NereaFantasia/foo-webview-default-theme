import { atom, createStore } from 'jotai/vanilla';
import type { Track } from 'foo-webview-sdk';
import { describe, expect, it, onTestFinished } from 'vitest';
import { startVideo } from '../../../src/video/videoService.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';

const VIDEO = {
  success: true as const,
  recognized: true,
  tracks: [{ id: '1', type: 'video' as const, codec: 'avc1' }],
  attachments: [],
};

const CHAPTERS = [
  { start: 0, end: 20, subsong: 1 },
  { start: 20, end: 45, subsong: 2 },
];

function setup() {
  const host = installFakeHost();
  host.answer('media.getContainerInfo', VIDEO);
  const store = createStore();
  const current = atom<Track | null>(null);
  const service = startVideo(store, current);
  onTestFinished(() => service.dispose());
  return { host, store, current, service };
}

describe('视频容器状态', () => {
  it('按公开 SDK 读取，只有视频轨才出现入口', async () => {
    const { host, store, current, service } = setup();
    const track = makeTrack({ path: 'E:\\movie.mp4', handle: 'E:\\movie.mp4', subsong: 0 });
    store.set(current, track);
    await expect.poll(() => store.get(service.state).status).toBe('ready');
    expect(store.get(service.state).path).toBe(track.handle);
    expect(host.callsTo('media.getContainerInfo')[0]).toEqual({ path: track.handle });
    host.answer('media.getContainerInfo', {
      ...VIDEO,
      tracks: [{ id: '1', type: 'image', codec: 'jpeg' }],
    });
    service.retry();
    await expect.poll(() => store.get(service.state).status).toBe('none');
    expect(store.get(service.state).track).toBeNull();
  });

  it('换曲立即清空旧画面，旧应答不能覆盖新曲目', async () => {
    const { host, store, current, service } = setup();
    const held = host.hold('media.getContainerInfo');
    store.set(current, makeTrack({ path: 'E:\\a.mp4' }));
    await expect.poll(() => held.pending.length).toBe(1);
    store.set(current, makeTrack({ path: 'E:\\b.mp4' }));
    expect(store.get(service.state).path).toBeNull();
    await expect.poll(() => held.pending.length).toBe(2);
    held.respond(1, { ...VIDEO, tracks: [] });
    await expect.poll(() => store.get(service.state).status).toBe('none');
    held.respond(0, VIDEO);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.get(service.state).status).toBe('none');
  });

  it('没有章节信息的子曲目保留视频事实但不装载', async () => {
    const { store, current, service } = setup();
    store.set(current, makeTrack({ subsong: 2 }));
    await expect.poll(() => store.get(service.state).status).toBe('subsong');
    expect(store.get(service.state).path).toBeNull();
    expect(store.get(service.state).track?.type).toBe('video');
  });

  it('章节表里没有当前子曲目号时同样不装载', async () => {
    const { host, store, current, service } = setup();
    host.answer('media.getContainerInfo', { ...VIDEO, chapters: CHAPTERS });
    store.set(current, makeTrack({ subsong: 3 }));
    await expect.poll(() => store.get(service.state).status).toBe('subsong');
    expect(store.get(service.state).path).toBeNull();
  });

  it('子曲目按所在章节的起点装载，地址不带子曲目后缀', async () => {
    const { host, store, current, service } = setup();
    host.answer('media.getContainerInfo', { ...VIDEO, chapters: CHAPTERS });
    store.set(current, makeTrack({ path: 'E:\\movie.mp4', subsong: 2 }));
    await expect.poll(() => store.get(service.state).status).toBe('ready');
    expect(store.get(service.state)).toMatchObject({ path: 'E:\\movie.mp4', timelineOffset: 20 });
    expect(host.callsTo('media.getContainerInfo')[0]).toEqual({ path: 'E:\\movie.mp4' });
  });

  it('同一文件的章节之间切换不再问宿主，也不经过加载中', async () => {
    const { host, store, current, service } = setup();
    host.answer('media.getContainerInfo', { ...VIDEO, chapters: CHAPTERS });
    store.set(current, makeTrack({ path: 'E:\\movie.mp4', subsong: 1 }));
    await expect.poll(() => store.get(service.state).status).toBe('ready');
    const seen: string[] = [];
    store.sub(service.state, () => seen.push(store.get(service.state).status));
    store.set(current, makeTrack({ path: 'E:\\movie.mp4', subsong: 2 }));
    expect(store.get(service.state)).toMatchObject({ status: 'ready', timelineOffset: 20 });
    store.set(current, makeTrack({ path: 'E:\\movie.mp4', subsong: 1 }));
    expect(store.get(service.state)).toMatchObject({ status: 'ready', timelineOffset: 0 });
    expect(seen).not.toContain('loading');
    expect(host.callsTo('media.getContainerInfo')).toHaveLength(1);
    store.set(current, makeTrack({ path: 'E:\\other.mp4', subsong: 1 }));
    expect(store.get(service.state).status).toBe('loading');
    await expect.poll(() => host.callsTo('media.getContainerInfo').length).toBe(2);
    service.retry();
    await expect.poll(() => host.callsTo('media.getContainerInfo').length).toBe(3);
  });

  it('宿主不认的封装：扩展名是视频才出入口，并带上封装名', async () => {
    const { host, store, current, service } = setup();
    host.answer('media.getContainerInfo', {
      success: true as const,
      recognized: false,
      tracks: [],
      attachments: [],
    });
    store.set(current, makeTrack({ path: 'E:\\clip.AVI' }));
    await expect.poll(() => store.get(service.state).status).toBe('container');
    expect(store.get(service.state)).toMatchObject({ format: 'AVI', path: null, track: null });
    store.set(current, makeTrack({ path: 'E:\\song.flac' }));
    await expect.poll(() => store.get(service.state).status).toBe('none');
    expect(store.get(service.state).format).toBeNull();
  });

  it('失败可重试，停止清空，释放后不再收迟到应答', async () => {
    const { host, store, current, service } = setup();
    host.answer('media.getContainerInfo', hostFailure('NOT_SUPPORTED'));
    store.set(current, makeTrack());
    await expect.poll(() => store.get(service.state).status).toBe('failed');
    host.answer('media.getContainerInfo', VIDEO);
    service.retry();
    await expect.poll(() => store.get(service.state).status).toBe('ready');
    store.set(current, null);
    expect(store.get(service.state).status).toBe('idle');
    const held = host.hold('media.getContainerInfo');
    store.set(current, makeTrack());
    await expect.poll(() => held.pending.length).toBe(1);
    service.dispose();
    held.respond(0, VIDEO);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.get(service.state).status).toBe('loading');
  });
});
