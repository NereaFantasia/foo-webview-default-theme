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

  it('子曲目保留视频事实但不装载容器时间轴', async () => {
    const { store, current, service } = setup();
    store.set(current, makeTrack({ subsong: 2 }));
    await expect.poll(() => store.get(service.state).status).toBe('subsong');
    expect(store.get(service.state).path).toBeNull();
    expect(store.get(service.state).track?.type).toBe('video');
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
