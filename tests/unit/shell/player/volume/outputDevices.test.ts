import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { READY_TIMEOUT_MS } from '../../../../../src/host/waitForHost.ts';
import {
  deviceKeyOf,
  outputDevicesAtom,
  outputGroupsOf,
  startOutputDevices,
} from '../../../../../src/shell/player/volume/outputDevices.ts';
import {
  DEFAULT_DEVICE_ID,
  hostFailure,
  OUTPUT_MODULES,
  outputDevice,
  outputEntry,
} from '../../../../fixtures/hostAnswers.ts';
import type { HostResponse } from '../../../../fixtures/fakeHost.ts';
import { installFakeHost, type UnitHost } from '../../../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const SPEAKERS = '{0000000D-0000-0000-0000-000000000001}';
const EXCLUSIVE = '{0000000D-0000-0000-0000-000000000002}';

const DEVICES = [
  outputDevice(OUTPUT_MODULES.directSound, DEFAULT_DEVICE_ID, 'Primary Sound Driver'),
  outputDevice(OUTPUT_MODULES.directSound, SPEAKERS, 'Speakers'),
  outputDevice(OUTPUT_MODULES.wasapi, EXCLUSIVE, 'Speakers [exclusive]'),
];

/** 三个设备，第 `current` 个生效。 */
function devicesAnswer(current: number): HostResponse<'config.getOutputDevices'> {
  const devices = DEVICES.map((row, at) => ({ ...row, isCurrent: at === current }));
  return { success: true, devices, count: devices.length };
}

/** 宿主按切换的目标改「当前」，像真宿主那样切成了才推事件。 */
function switchable(host: UnitHost): void {
  let current = 0;
  host.answer('config.getOutputDevices', () => devicesAnswer(current));
  host.answer('config.setOutputDevice', (params) => {
    const at = DEVICES.findIndex(
      (row) => row.outputId === params['outputId'] && row.deviceId === params['deviceId'],
    );
    if (at < 0) return hostFailure('NOT_FOUND', 'device not found');
    current = at;
    queueMicrotask(() => host.emit('audio:outputDeviceChanged', {}));
    return { success: true };
  });
}

async function start(host: UnitHost) {
  const store = createStore();
  const service = startOutputDevices(store, host.fb);
  await service.ready;
  await settle();
  return { store, service, state: () => store.get(outputDevicesAtom) };
}

describe('startOutputDevices', () => {
  it('先订阅再初读：初读发出时事件已订上；设备带上模块名，标出当前生效的那个', async () => {
    const host = installFakeHost();
    const subscribedAtRead: number[] = [];
    host.answer('config.getOutputDevices', () => {
      subscribedAtRead.push(host.listenerCount('audio:outputDeviceChanged'));
      return devicesAnswer(1);
    });
    const { state } = await start(host);
    expect(subscribedAtRead).toEqual([1]);
    expect(state().status).toBe('ready');
    expect(state().devices.map((row) => [row.name, row.outputName])).toEqual([
      ['Primary Sound Driver', 'DirectSound'],
      ['Speakers', 'DirectSound'],
      ['Speakers [exclusive]', 'WASAPI (shared)'],
    ]);
    expect(state().current?.deviceId).toBe(SPEAKERS);
  });

  it('输出设置变了就回读', async () => {
    const host = installFakeHost();
    host.answer('config.getOutputDevices', devicesAnswer(0));
    const { state } = await start(host);
    host.answer('config.getOutputDevices', devicesAnswer(2));
    host.emit('audio:outputDeviceChanged', {});
    await settle();
    expect(state().current?.deviceId).toBe(EXCLUSIVE);
  });

  it('连着的几次回读只认最后发出的那一次，先发的晚到也丢掉', async () => {
    const host = installFakeHost();
    host.answer('config.getOutputDevices', devicesAnswer(0));
    const { state } = await start(host);
    const reads = host.hold('config.getOutputDevices');
    host.emit('audio:outputDeviceChanged', {});
    host.emit('audio:outputDeviceChanged', {});
    expect(reads.pending).toHaveLength(2);
    reads.respond(1, devicesAnswer(2));
    await settle();
    reads.respond(0, devicesAnswer(1));
    await settle();
    expect(state().current?.deviceId).toBe(EXCLUSIVE);
  });

  it('切换：调到那个模块与设备的 GUID，以回读为准', async () => {
    const host = installFakeHost();
    switchable(host);
    const { service, state } = await start(host);
    await service.select(OUTPUT_MODULES.wasapi, EXCLUSIVE);
    await settle();
    expect(host.callsTo('config.setOutputDevice')).toEqual([
      { outputId: OUTPUT_MODULES.wasapi, deviceId: EXCLUSIVE },
    ]);
    expect(state().current?.deviceId).toBe(EXCLUSIVE);
    expect(state().selectFailed).toBe(false);
  });

  it('切换失败留在原设备并报失败；之后一次切换成功时收起', async () => {
    const host = installFakeHost();
    switchable(host);
    const { service, state } = await start(host);
    await service.select(OUTPUT_MODULES.wasapi, '{0000000D-0000-0000-0000-00000000DEAD}');
    expect(state().selectFailed).toBe(true);
    expect(state().current?.deviceId).toBe(DEFAULT_DEVICE_ID);
    await service.select(OUTPUT_MODULES.directSound, SPEAKERS);
    expect(state().selectFailed).toBe(false);
    expect(state().current?.deviceId).toBe(SPEAKERS);
  });

  it('切换还没答时再选两次：只再发最后一次，前一次的失败不报', async () => {
    const host = installFakeHost();
    switchable(host);
    const { service, state } = await start(host);
    const sets = host.hold('config.setOutputDevice');
    const first = service.select(OUTPUT_MODULES.directSound, SPEAKERS);
    void service.select(OUTPUT_MODULES.directSound, DEFAULT_DEVICE_ID);
    const last = service.select(OUTPUT_MODULES.wasapi, EXCLUSIVE);
    expect(sets.pending).toHaveLength(1);
    sets.respond(0, hostFailure('OPERATION_FAILED'));
    await settle();
    sets.release();
    await Promise.all([first, last]);
    expect(host.callsTo('config.setOutputDevice').map((call) => call['deviceId'])).toEqual([
      SPEAKERS,
      EXCLUSIVE,
    ]);
    expect(state().selectFailed).toBe(false);
    expect(state().current?.deviceId).toBe(EXCLUSIVE);
  });

  it('读失败时留着旧清单、标 failed，下一次读成功回到 ready', async () => {
    const host = installFakeHost();
    host.answer('config.getOutputDevices', devicesAnswer(0));
    const { service, state } = await start(host);
    host.answer('config.getOutputDevices', hostFailure('INTERNAL_ERROR'));
    service.refresh();
    await settle();
    expect(state()).toMatchObject({ status: 'failed' });
    expect(state().devices).toHaveLength(3);
    host.answer('config.getOutputDevices', devicesAnswer(1));
    service.refresh();
    await settle();
    expect(state()).toMatchObject({ status: 'ready' });
    expect(state().current?.deviceId).toBe(SPEAKERS);
  });

  it('模块清单读失败时模块名为空，下一次读再问；读成了就不再问', async () => {
    const host = installFakeHost();
    host.answer('output.getEntries', hostFailure('INTERNAL_ERROR'));
    const { service, state } = await start(host);
    expect(state().devices.map((row) => row.outputName)).toEqual(['', '', '']);
    host.answer('output.getEntries', {
      success: true,
      entries: [outputEntry(OUTPUT_MODULES.directSound, 'DS')],
      count: 1,
    });
    service.refresh();
    await settle();
    service.refresh();
    await settle();
    expect(state().devices.map((row) => row.outputName)).toEqual(['DS', 'DS', '']);
    expect(host.callsTo('output.getEntries')).toHaveLength(2);
  });

  it('释放之后晚到的应答不写状态，也不再跟事件', async () => {
    const host = installFakeHost();
    const reads = host.hold('config.getOutputDevices');
    const store = createStore();
    const service = startOutputDevices(store, host.fb);
    await settle();
    service.dispose();
    reads.respond(0, devicesAnswer(2));
    await settle();
    expect(store.get(outputDevicesAtom)).toMatchObject({ status: 'loading', current: null });
    expect(host.listenerCount('audio:outputDeviceChanged')).toBe(0);
  });

  it('等不到宿主：标 unavailable，切换一条都不发', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const store = createStore();
    const service = startOutputDevices(store, host.fb);
    await service.select(OUTPUT_MODULES.wasapi, EXCLUSIVE);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await service.ready;
    await service.select(OUTPUT_MODULES.wasapi, EXCLUSIVE);
    expect(store.get(outputDevicesAtom).status).toBe('unavailable');
    expect(host.callsTo('config.setOutputDevice')).toEqual([]);
  });
});

describe('outputGroupsOf', () => {
  it('按模块分组，组按首次出现的先后，同一模块不挨着的设备也归进一组', () => {
    const row = (outputId: string, name: string) => ({
      outputId,
      deviceId: name,
      name,
      outputName: outputId === 'a' ? 'A' : 'B',
    });
    const groups = outputGroupsOf([row('a', '1'), row('b', '2'), row('a', '3')]);
    expect(groups.map((group) => [group.outputName, group.devices.map((d) => d.name)])).toEqual([
      ['A', ['1', '3']],
      ['B', ['2']],
    ]);
  });

  it('设备的身份连同模块：两个模块的缺省设备 GUID 相同也分得开', () => {
    const a = { outputId: 'a', deviceId: DEFAULT_DEVICE_ID };
    const b = { outputId: 'b', deviceId: DEFAULT_DEVICE_ID };
    expect(deviceKeyOf(a)).not.toBe(deviceKeyOf(b));
  });
});
