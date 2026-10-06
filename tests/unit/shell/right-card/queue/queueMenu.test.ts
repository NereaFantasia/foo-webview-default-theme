import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import { startQueueMenu } from '../../../../../src/shell/right-card/queue/queueMenu.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const FIRST = ['file://E:/Music/a.flac', 'file://E:/Music/disc.cue|subsong:2'];
const SECOND = ['file://E:/Music/b.flac'];
const GUID = '{33333333-3333-3333-3333-333333333333}';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup() {
  const host = installFakeHost();
  const service = startQueueMenu(createStore(), host.fb);
  onTestFinished(() => service.dispose());
  await service.prepare(FIRST);
  return { host, service };
}

describe('队列菜单发送', () => {
  it('新建应答之前换了菜单对象：仍发送开始时的曲目及分轨', async () => {
    const { host, service } = await setup();
    const held = host.hold('playlist.create');
    const pending = service.sendToNew('First');
    await flush();
    expect(held.pending).toHaveLength(1);
    await service.prepare(SECOND);
    held.respond(0, { success: true, index: 1, guid: GUID });
    expect(await pending).toBe(true);
    expect(host.callsTo('library.addToPlaylist')).toEqual([{ paths: FIRST, playlistGuid: GUID }]);
  });

  it('两次新建应答倒序到达：各自发送各自的曲目', async () => {
    const { host, service } = await setup();
    const held = host.hold('playlist.create');
    const first = service.sendToNew('First');
    await service.prepare(SECOND);
    const second = service.sendToNew('Second');
    await flush();
    expect(held.pending).toHaveLength(2);
    const secondGuid = '{44444444-4444-4444-4444-444444444444}';
    held.respond(1, { success: true, index: 2, guid: secondGuid });
    expect(await second).toBe(true);
    held.respond(0, { success: true, index: 1, guid: GUID });
    expect(await first).toBe(true);
    expect(host.callsTo('library.addToPlaylist')).toEqual([
      { paths: SECOND, playlistGuid: secondGuid },
      { paths: FIRST, playlistGuid: GUID },
    ]);
  });

  it('新建失败：不发送曲目', async () => {
    const { host, service } = await setup();
    host.answer('playlist.create', hostFailure('INTERNAL_ERROR'));
    expect(await service.sendToNew('First')).toBe(false);
    expect(host.callsTo('library.addToPlaylist')).toEqual([]);
  });

  it('没有菜单对象：不创建空列表', async () => {
    const { host, service } = await setup();
    await service.prepare([]);
    expect(await service.sendToNew('Empty')).toBe(false);
    expect(host.callsTo('playlist.create')).toEqual([]);
  });

  it('服务释放后新建应答才到：不继续发送，也不再发起新写入', async () => {
    const { host, service } = await setup();
    const held = host.hold('playlist.create');
    const pending = service.sendToNew('First');
    await flush();
    service.dispose();
    held.respond(0, { success: true, index: 1, guid: GUID });
    expect(await pending).toBe(false);
    held.release();
    expect(await service.sendToNew('Later')).toBe(false);
    expect(await service.sendTo(GUID)).toBe(false);
    expect(host.callsTo('playlist.create')).toHaveLength(1);
    expect(host.callsTo('library.addToPlaylist')).toEqual([]);
  });
});
