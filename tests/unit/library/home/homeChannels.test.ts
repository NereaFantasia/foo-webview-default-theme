import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { createConfigWriter } from '../../../../src/host/configWrite.ts';
import { DATA_GENERATION_PREFIX } from '../../../../src/kit/dataWrite.ts';
import {
  HOME_CHANNELS_KEY,
  parseHomeChannels,
  startHomeChannels,
  type ChannelSort,
} from '../../../../src/library/home/homeChannels.ts';
import { createMemoryDataWriter, occupyWriteLock } from '../../../fixtures/dataWriter.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const channel = { id: 'one', name: '收藏', query: 'ALL', sort: 'album' } as const;
function setup(raw: unknown = [], withWriter = true) {
  const host = installFakeHost();
  host.answer('config.get', {
    success: true,
    found: true,
    key: HOME_CHANNELS_KEY,
    value: JSON.parse(JSON.stringify(raw)),
  });
  const store = createStore();
  const data = createMemoryDataWriter();
  const writer = withWriter ? createConfigWriter(host.fb, data.writer) : undefined;
  const service = startHomeChannels(store, host.fb, writer);
  onTestFinished(() => service.dispose());
  return { host, data, service, state: () => store.get(service.state) };
}
describe('首页频道存档', () => {
  it('校验外部存档，拒绝重复身份、未知排序、空白和超长输入', () => {
    expect(parseHomeChannels([channel])).toEqual([channel]);
    for (const value of [
      null,
      {},
      [channel, channel],
      [{ ...channel, sort: 'bad' }],
      [{ ...channel, query: ' ' }],
      [{ ...channel, name: 'a'.repeat(121) }],
    ]) {
      expect(parseHomeChannels(value)).toBeNull();
    }
  });
  it('读取失败禁止覆盖未知存档，重试成功后才保存', async () => {
    const { host, service, state } = setup(null);
    await service.ready;
    expect(state().status).toBe('failed');
    expect(await service.save(channel)).toBe(false);
    expect(host.callsTo('config.set')).toEqual([]);
    host.answer('config.get', { success: true, found: false, key: HOME_CHANNELS_KEY, value: null });
    await service.retry();
    expect(await service.save(channel)).toBe(true);
    expect(state().items).toEqual([channel]);
  });
  it('保存失败保留旧列表；串行写，成功后清除错误', async () => {
    const { host, service, state } = setup([channel]);
    await service.ready;
    const held = host.hold('config.set');
    const edit = service.save({ ...channel, name: '新名称' }, true);
    expect(await service.remove(channel.id)).toBe(false);
    expect(state().items).toEqual([channel]);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0, hostFailure('OPERATION_FAILED'));
    expect(await edit).toBe(false);
    expect(state()).toMatchObject({ items: [channel], saveFailed: true, saving: false });
    const removed = service.remove(channel.id);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0, { success: true, key: HOME_CHANNELS_KEY });
    expect(await removed).toBe(true);
    expect(state()).toMatchObject({ items: [], saveFailed: false, saving: false });
  });
  it('释放后不接晚到的读取', async () => {
    const { host, service, state } = setup();
    await service.ready;
    const held = host.hold('config.get');
    const pending = service.retry();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.dispose();
    const before = state();
    held.respond(0, { success: true, found: true, key: HOME_CHANNELS_KEY, value: [channel] });
    await pending;
    expect(state()).toBe(before);
  });
  it('保存经写入助手记代数；没有写入助手时按失败处理，不直接写宿主', async () => {
    const env = setup();
    await env.service.ready;
    expect(await env.service.save(channel)).toBe(true);
    expect(env.data.values.get(`${DATA_GENERATION_PREFIX}config:${HOME_CHANNELS_KEY}`)).toBe('1');

    const bare = setup([], false);
    await bare.service.ready;
    expect(await bare.service.save(channel)).toBe(false);
    expect(bare.state()).toMatchObject({ items: [], saveFailed: true, saving: false });
    expect(bare.host.callsTo('config.set')).toEqual([]);
  });
  it('等锁期间调用方改动传入的对象，显示与落盘仍是发起保存时的内容', async () => {
    const env = setup();
    await env.service.ready;
    const release = await occupyWriteLock(env.data.writer);
    const draft: { id: string; name: string; query: string; sort: ChannelSort } = { ...channel };
    const saving = env.service.save(draft);
    draft.name = '改动';
    await release();
    expect(await saving).toBe(true);
    expect(env.state().items).toEqual([channel]);
    expect(env.host.config.get(HOME_CHANNELS_KEY)).toEqual([channel]);
  });
  it('释放时取消仍在等锁的写入', async () => {
    const env = setup();
    await env.service.ready;
    const release = await occupyWriteLock(env.data.writer);
    const saving = env.service.save(channel);
    env.service.dispose();
    await release();
    expect(await saving).toBe(false);
    expect(env.data.values.size).toBe(0);
    expect(env.host.callsTo('config.set')).toEqual([]);
  });
});
