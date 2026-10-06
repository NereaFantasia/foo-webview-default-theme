import { describe, expect, it, vi } from 'vitest';
import { createConfigWriter } from '../../../src/host/configWrite.ts';
import { createTraySwitches, TRAY_CONFIG_KEYS } from '../../../src/playback/traySwitches.ts';
import { createMemoryDataWriter, occupyWriteLock } from '../../fixtures/dataWriter.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const OK = { rejected: false, unsaved: false };

function create(host: UnitHost, data = createMemoryDataWriter()) {
  return createTraySwitches(host.fb, createConfigWriter(host.fb, data.writer));
}

/** 等替身在微任务里收下调用。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createTraySwitches', () => {
  it('读回 config 里的布尔并下发给宿主；不是布尔的值不认', async () => {
    const host = installFakeHost({
      config: { [TRAY_CONFIG_KEYS.minimizeToTray]: true, [TRAY_CONFIG_KEYS.closeToTray]: 'yes' },
    });
    const switches = create(host);
    expect(await switches.restore()).toEqual({ minimizeToTray: OK, closeToTray: OK });
    expect(switches.values()).toEqual({ minimizeToTray: true, closeToTray: false });
    expect(host.callsTo('tray.setMinimizeToTray')).toEqual([{ enabled: true }]);
    expect(host.callsTo('tray.setCloseToTray')).toEqual([{ enabled: false }]);
  });

  it('连上之前用户先改过的为准，连上后补写 config', async () => {
    const host = installFakeHost({ config: { [TRAY_CONFIG_KEYS.closeToTray]: false } });
    const switches = create(host);
    await switches.set('closeToTray', true, false);
    expect(host.callsTo('tray.setCloseToTray')).toEqual([]);
    await switches.restore();
    expect(switches.values().closeToTray).toBe(true);
    expect(host.config.get(TRAY_CONFIG_KEYS.closeToTray)).toBe(true);
    expect(host.callsTo('tray.setCloseToTray')).toEqual([{ enabled: true }]);
  });

  it('读回途中用户改了：读回的旧值不采用，也不再下发旧值', async () => {
    const host = installFakeHost({
      config: { [TRAY_CONFIG_KEYS.minimizeToTray]: true, [TRAY_CONFIG_KEYS.closeToTray]: false },
    });
    const switches = create(host);
    const reads = host.hold('config.get');
    const restoring = switches.restore();
    await settle();
    expect(reads.pending.map((params) => params['key'])).toEqual([
      TRAY_CONFIG_KEYS.minimizeToTray,
      TRAY_CONFIG_KEYS.closeToTray,
    ]);
    expect(await switches.set('closeToTray', true, true)).toEqual(OK);
    // 宿主按到达先后处理：读取排在用户改之前，答的是旧值，只是应答晚到。
    reads.respond(1, {
      success: true,
      key: TRAY_CONFIG_KEYS.closeToTray,
      value: false,
      found: true,
    });
    reads.release();
    // 读回途中改过的那只以用户那次改动的结果为准，读回不再报。
    expect(await restoring).toEqual({ minimizeToTray: OK, closeToTray: null });

    expect(switches.values()).toEqual({ minimizeToTray: true, closeToTray: true });
    expect(host.config.get(TRAY_CONFIG_KEYS.closeToTray)).toBe(true);
    const sent = host.callsTo('tray.setCloseToTray');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((params) => params['enabled'] === true)).toBe(true);
  });

  it('连上之后改：下发并存下；宿主拒收时答失败，值停在用户选的', async () => {
    const host = installFakeHost();
    const switches = create(host);
    await switches.restore();
    expect(await switches.set('minimizeToTray', true, true)).toEqual(OK);
    expect(host.config.get(TRAY_CONFIG_KEYS.minimizeToTray)).toBe(true);

    host.answer('tray.setCloseToTray', hostFailure('OPERATION_FAILED'));
    expect(await switches.set('closeToTray', true, true)).toEqual({
      rejected: true,
      unsaved: false,
    });
    expect(switches.values().closeToTray).toBe(true);
  });

  it('读回失败停在缺省值，照样下发；下发失败的那只报出来', async () => {
    const host = installFakeHost();
    host.answer('config.get', () => {
      throw new Error('bridge gone');
    });
    host.answer('tray.setMinimizeToTray', hostFailure('OPERATION_FAILED'));
    const switches = create(host);
    expect(await switches.restore()).toEqual({
      minimizeToTray: { rejected: true, unsaved: false },
      closeToTray: OK,
    });
    expect(switches.values()).toEqual({ minimizeToTray: false, closeToTray: false });
  });

  it('下发与保存分开报：宿主收下了但没存住答未保存；没有写入助手时不直接写宿主', async () => {
    const host = installFakeHost();
    const switches = create(host);
    await switches.restore();
    host.answer('config.set', hostFailure('OPERATION_FAILED'));
    expect(await switches.set('closeToTray', true, true)).toEqual({
      rejected: false,
      unsaved: true,
    });
    expect(switches.values().closeToTray).toBe(true);

    const bare = installFakeHost();
    const unwritten = createTraySwitches(bare.fb);
    await unwritten.restore();
    expect(await unwritten.set('minimizeToTray', true, true)).toEqual({
      rejected: false,
      unsaved: true,
    });
    expect(bare.callsTo('config.set')).toEqual([]);
    expect(bare.callsTo('tray.setMinimizeToTray').at(-1)).toEqual({ enabled: true });
  });

  it('连上之前的改动补写失败时，restore 报这只未保存', async () => {
    const host = installFakeHost();
    host.answer('config.set', hostFailure('OPERATION_FAILED'));
    const switches = create(host);
    expect(await switches.set('minimizeToTray', true, false)).toEqual(OK);
    expect(await switches.restore()).toEqual({
      minimizeToTray: { rejected: false, unsaved: true },
      closeToTray: OK,
    });
  });

  it('结果回来之前又改了这只：前一次的结果作废', async () => {
    const host = installFakeHost();
    const switches = create(host);
    await switches.restore();
    const held = host.hold('config.set');
    const first = switches.set('closeToTray', true, true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const second = switches.set('closeToTray', false, true);
    held.respond(0, hostFailure('OPERATION_FAILED'));
    expect(await first).toBeNull();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0);
    expect(await second).toEqual(OK);
    expect(host.config.get(TRAY_CONFIG_KEYS.closeToTray)).toBe(false);
  });

  it('释放时取消仍在等锁的保存', async () => {
    const host = installFakeHost();
    const data = createMemoryDataWriter();
    const switches = create(host, data);
    await switches.restore();
    const release = await occupyWriteLock(data.writer);
    const saving = switches.set('closeToTray', true, true);
    switches.dispose();
    await release();
    expect(await saving).toEqual({ rejected: false, unsaved: true });
    expect(host.callsTo('config.set')).toEqual([]);
    expect(data.values.size).toBe(0);
  });
});
