import { createMemoryConfigWriter, createMemoryDataWriter } from '../../fixtures/dataWriter.ts';
import { atom, createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { settle as hostSettle } from '../../../src/host/hostCall.ts';
import { diagnosticText, REQUIRED_HOST_VERSION } from '../../../src/host/hostInfo.ts';
import { READY_TIMEOUT_MS } from '../../../src/host/waitForHost.ts';
import { libraryNotConfiguredAtom, startAlbums } from '../../../src/library/albums.ts';
import { playcountMissingAtom, startPlayStats } from '../../../src/library/playStats.ts';
import {
  diagnosticsAtom,
  dismissedCountAtom,
  hasBlockingAtom,
  infoBannerAtom,
  infoMessagesAtom,
  startInfoCenter,
  preferenceSaveSummaryAtom,
  type UpdateNotice,
} from '../../../src/host/infoCenter.ts';
import { defineConfigPref, startConfigPrefs } from '../../../src/host/configPref.ts';
import {
  openPrefStorage,
  prefSaveStatesAtom,
  prefStorageAvailableAtom,
} from '../../../src/kit/prefStorage.ts';
import {
  HOST_VERSION,
  hostFailure,
  methodNotFound,
  type ConfigValue,
} from '../../fixtures/hostAnswers.ts';
import { trackRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

/** 与装配层一样，提醒条件取自媒体库与播放统计。 */
const REMINDERS = {
  playcountMissing: playcountMissingAtom,
  libraryNotConfigured: libraryNotConfiguredAtom,
};

afterEach(() => {
  vi.useRealTimers();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const DISMISSED_KEY = 'defaultTheme.infoCenter.dismissed';

function versionIs(host: UnitHost, version: string): void {
  host.answer('config.getVersionInfo', {
    success: true,
    version: 'foobar2000 v2.24.1',
    foobar2000: 'foobar2000 v2.24.1',
    versionFull: 'foobar2000',
    is64bit: true,
    isPortable: true,
    profilePath: 'E:/FB2K/foobar2000/profile',
    plugin: { name: 'foo_ui_webview2', version },
  });
}

async function start(host: UnitHost) {
  const store = createStore();
  const service = startInfoCenter(store, REMINDERS, host.fb, createMemoryConfigWriter(host.fb));
  // 收听者登记在模块级，不释放会漏到后面的测试里。
  onTestFinished(() => service.dispose());
  await service.ready;
  await settle();
  return {
    store,
    service,
    kinds: () => store.get(infoMessagesAtom).map((message) => message.kind),
    banner: () => store.get(infoBannerAtom).map((message) => message.kind),
  };
}

/** 探一次 foo_playcount 装没装；替身的缺省应答是没装：各首的求值都是空串。 */
async function probePlaycount(host: UnitHost, store: ReturnType<typeof createStore>) {
  await startPlayStats(store, host.fb).probe([trackRow('Modal Soul', 'Feather')]);
}

describe('startInfoCenter', () => {
  it('汇总宿主与浏览器偏好失败，重试只保存失败项，部分失败仍保留提示', async () => {
    const host = installFakeHost();
    const store = createStore();
    const writer = createMemoryConfigWriter(host.fb);
    const data = createMemoryDataWriter();
    let localFailed = true;
    const local = await openPrefStorage(
      {
        readAll: async () => ({ success: true, value: new Map() }),
        run: (work, signal) =>
          localFailed
            ? Promise.resolve({ success: false as const, reason: 'write-failed' as const })
            : data.writer.run(work, signal),
      },
      null,
    );
    const off = local.subscribe(() => store.set(prefSaveStatesAtom, local.snapshot()));
    const service = startInfoCenter(store, REMINDERS, host.fb, writer, local);
    const pref = defineConfigPref('defaultTheme.example.choice', 'default', (raw) =>
      typeof raw === 'string' ? raw : undefined,
    );
    const config = startConfigPrefs(store, [pref], host.fb, writer);
    onTestFinished(() => {
      off();
      service.dispose();
      config.dispose();
      local.dispose();
    });
    await Promise.all([service.ready, config.ready]);
    host.answer('config.set', hostFailure('OPERATION_FAILED'));
    await config.set(pref, 'chosen');
    local.setItem('default-theme.example.v1', 'width');
    await local.settled();
    expect(store.get(infoMessagesAtom)).toEqual([
      { kind: 'preferencesUnsaved', level: 'reminder', params: { count: 2 } },
    ]);
    expect(store.get(infoBannerAtom)).toEqual([]);
    host.answer('config.set', (params) => {
      host.config.set(pref.key, String(params['value']));
      return { success: true, key: pref.key };
    });
    await service.retryPreferences();
    expect(store.get(config.state).get(pref.key)?.status).toBe('saved');
    expect(store.get(preferenceSaveSummaryAtom)).toEqual({
      failed: 1,
      unavailable: false,
      retrying: false,
    });
    localFailed = false;
    host.answer('config.set', hostFailure('OPERATION_FAILED'));
    await service.retryPreferences();
    expect(host.config.get(pref.key)).toBe('chosen');
    expect(data.values.get('default-theme.example.v1')).toBe('width');
    expect(store.get(config.state).get(pref.key)?.status).toBe('saved');
    expect(store.get(infoMessagesAtom)).toEqual([]);
  });

  it('初始化存储不可用时即提示，不等用户改设置；不与失败项重复计数', async () => {
    const env = await start(installFakeHost());
    env.store.set(prefStorageAvailableAtom, false);
    env.store.set(
      prefSaveStatesAtom,
      new Map([['default-theme.example.v1', { status: 'failed', reason: 'unavailable' }]]),
    );
    expect(env.kinds()).toEqual(['preferenceStorageUnavailable']);
    expect(env.banner()).toEqual([]);
    expect(env.store.get(preferenceSaveSummaryAtom)).toEqual({
      failed: 0,
      unavailable: true,
      retrying: false,
    });
  });

  it('重试尚未结束时保留汇总入口，连点不重复保存，释放后不发布迟到结果', async () => {
    const host = installFakeHost();
    const env = await start(host);
    host.answer('config.set', hostFailure('OPERATION_FAILED'));
    env.service.dismissReminder('playcountMissing');
    await env.service.persistence.settled();
    const held = host.hold('config.set');
    const retry = env.service.retryPreferences();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    expect(env.kinds()).toEqual(['preferencesUnsaved']);
    expect(env.store.get(preferenceSaveSummaryAtom).retrying).toBe(true);
    await env.service.retryPreferences();
    expect(held.pending).toHaveLength(1);
    env.service.dispose();
    const before = env.store.get(preferenceSaveSummaryAtom);
    held.release();
    await retry;
    expect(env.store.get(preferenceSaveSummaryAtom)).toBe(before);
  });

  it('版本满足、一切正常：没有消息、没有横幅；诊断信息取自版本核对', async () => {
    const host = installFakeHost();
    const { store, kinds, banner } = await start(host);
    expect(kinds()).toEqual([]);
    expect(banner()).toEqual([]);
    expect(store.get(hasBlockingAtom)).toBe(false);
    const diagnostics = store.get(diagnosticsAtom);
    expect(diagnostics).toMatchObject({ pluginVersion: HOST_VERSION, isPortable: true });
    expect(diagnostics && diagnosticText(diagnostics)).toBe(
      [
        'foobar2000 v2.25 (64-bit, portable)',
        `foo_ui_webview2 ${HOST_VERSION} (requires ${REQUIRED_HOST_VERSION} or later)`,
      ].join('\n'),
    );
  });

  it('插件版本过低：阻断级，带当前与要求的版本，出横幅', async () => {
    const host = installFakeHost();
    versionIs(host, '1.12.3');
    const { store, banner } = await start(host);
    expect(store.get(infoMessagesAtom)).toEqual([
      {
        kind: 'hostTooOld',
        level: 'blocking',
        params: { version: '1.12.3', required: REQUIRED_HOST_VERSION },
      },
    ]);
    expect(store.get(hasBlockingAtom)).toBe(true);
    expect(banner()).toEqual(['hostTooOld']);
  });

  it('读不到版本与连不上宿主分开报；再核对一次成了，消息随之消失', async () => {
    const host = installFakeHost();
    host.answer('config.getVersionInfo', hostFailure('OPERATION_FAILED', 'E:\\profile locked'));
    const first = await start(host);
    expect(first.kinds()).toEqual(['hostVersionUnreadable']);
    expect(first.store.get(infoMessagesAtom)[0]?.params).toEqual({});
    expect(first.store.get(diagnosticsAtom)).toBeNull();

    host.answer('config.getVersionInfo', () => {
      throw new Error('Request timeout');
    });
    const second = await start(host);
    expect(second.kinds()).toEqual(['hostUnreachable']);
    versionIs(host, HOST_VERSION);
    second.service.retry();
    await settle();
    expect(second.kinds()).toEqual([]);
  });

  it('宿主答了错（带错误码的 reject）算读不到版本，不算连不上宿主', async () => {
    const host = installFakeHost();
    host.answer('config.getVersionInfo', () => {
      throw Object.assign(new Error('boom'), { code: 'INTERNAL_ERROR' });
    });
    expect((await start(host)).kinds()).toEqual(['hostVersionUnreadable']);
    host.answer('config.getVersionInfo', () => {
      throw methodNotFound('config.getVersionInfo');
    });
    const missing = await start(host);
    expect(missing.kinds()).toEqual(['hostVersionUnreadable', 'hostMethodMissing']);
    expect(missing.store.get(infoMessagesAtom)[1]?.params).toEqual({
      methods: 'config.getVersionInfo',
    });
  });

  it('版本核对只认最后发出的那一次；释放之后晚到的应答不写', async () => {
    const host = installFakeHost();
    host.answer('config.getVersionInfo', hostFailure('OPERATION_FAILED'));
    const { service, kinds } = await start(host);
    const checks = host.hold('config.getVersionInfo');
    service.retry();
    service.retry();
    expect(checks.pending).toHaveLength(2);
    versionIs(host, HOST_VERSION);
    checks.respond(1);
    await settle();
    checks.respond(0, hostFailure('OPERATION_FAILED'));
    await settle();
    expect(kinds()).toEqual([]);

    const store = createStore();
    const late = startInfoCenter(store, REMINDERS, host.fb, createMemoryConfigWriter(host.fb));
    await settle();
    late.dispose();
    versionIs(host, '1.12.3');
    checks.release();
    await settle();
    expect(store.get(infoMessagesAtom)).toEqual([]);
    expect(store.get(diagnosticsAtom)).toBeNull();
  });

  it('版本还没读到时，点过「不再提示」的提醒不出，不会启动时闪一下', async () => {
    const host = installFakeHost({ config: { [DISMISSED_KEY]: { playcountMissing: '2.1.0' } } });
    const checks = host.hold('config.getVersionInfo');
    const store = createStore();
    const service = startInfoCenter(store, REMINDERS, host.fb, createMemoryConfigWriter(host.fb));
    onTestFinished(() => service.dispose());
    await settle();
    await probePlaycount(host, store);
    expect(store.get(infoMessagesAtom)).toEqual([]);
    checks.respond(0, hostFailure('OPERATION_FAILED'));
    await service.ready;
    expect(store.get(infoMessagesAtom).map((message) => message.kind)).toEqual([
      'hostVersionUnreadable',
    ]);
  });

  it('普通浏览器里打开、等不到宿主：什么都不报，也不问版本', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const store = createStore();
    const service = startInfoCenter(store, REMINDERS, host.fb, createMemoryConfigWriter(host.fb));
    onTestFinished(() => service.dispose());
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await service.ready;
    expect(store.get(infoMessagesAtom)).toEqual([]);
    expect(store.get(diagnosticsAtom)).toBeNull();
    expect(host.calls).toEqual([]);
  });

  it('宿主不认的方法：按种类合成一条，方法名去重并按先后列出', async () => {
    const host = installFakeHost();
    host.answer('config.getOutputDevices', () => {
      throw methodNotFound('config.getOutputDevices');
    });
    host.answer('output.getEntries', () => {
      throw methodNotFound('output.getEntries');
    });
    const { store, kinds } = await start(host);
    await hostSettle(() => host.fb.config.getOutputDevices());
    await hostSettle(() => host.fb.output.getEntries());
    await hostSettle(() => host.fb.config.getOutputDevices());
    expect(kinds()).toEqual(['hostMethodMissing']);
    expect(store.get(infoMessagesAtom)[0]?.params).toEqual({
      methods: 'config.getOutputDevices, output.getEntries',
    });
  });

  it('认不出方法名时只报有方法宿主不认，不带参数', async () => {
    const host = installFakeHost();
    const { store } = await start(host);
    await hostSettle(async () => {
      throw Object.assign(new Error('Method not found'), { code: 'METHOD_NOT_FOUND' });
    });
    expect(store.get(infoMessagesAtom)).toEqual([
      { kind: 'hostMethodMissing', level: 'blocking', params: {} },
    ]);
  });

  it('释放之后不再收宿主不认的方法', async () => {
    const host = installFakeHost();
    const { store, service } = await start(host);
    service.dispose();
    await hostSettle(async () => {
      throw methodNotFound('config.getOutputDevices');
    });
    expect(store.get(infoMessagesAtom)).toEqual([]);
  });

  it('提醒级：媒体库没配置、没装 foo_playcount；阻断级排在前面；配置好了媒体库那条随之消失', async () => {
    const host = installFakeHost();
    versionIs(host, '1.12.3');
    host.answer('library.isEnabled', { success: true, enabled: false });
    const { store, kinds } = await start(host);
    const albums = startAlbums(store, host.fb);
    await albums.ready;
    await probePlaycount(host, store);
    expect(kinds()).toEqual(['hostTooOld', 'playcountMissing', 'libraryNotConfigured']);
    expect(store.get(infoMessagesAtom).map((message) => message.level)).toEqual([
      'blocking',
      'reminder',
      'reminder',
    ]);
    expect(store.get(infoBannerAtom).map((message) => message.kind)).toEqual(['hostTooOld']);
    host.answer('library.isEnabled', { success: true, enabled: true });
    await albums.retry();
    expect(kinds()).toEqual(['hostTooOld', 'playcountMissing']);
    albums.dispose();
  });

  it('横幅关掉后本次运行不再出，信息中心里照留；之后新出的阻断级照常出横幅', async () => {
    const host = installFakeHost();
    versionIs(host, '1.12.3');
    const { service, kinds, banner } = await start(host);
    service.closeBanner();
    expect(banner()).toEqual([]);
    expect(kinds()).toEqual(['hostTooOld']);
    await hostSettle(async () => {
      throw methodNotFound('ui.setMaximizeButtonRegion');
    });
    expect(banner()).toEqual(['hostMethodMissing']);
    expect(kinds()).toEqual(['hostTooOld', 'hostMethodMissing']);
  });

  it('「不再提示」按种类与插件版本记进 config；同一版本下次启动不提示，换了版本再提示', async () => {
    const host = installFakeHost();
    const first = await start(host);
    await probePlaycount(host, first.store);
    expect(first.kinds()).toEqual(['playcountMissing']);
    first.service.dismissReminder('playcountMissing');
    await settle();
    expect(first.kinds()).toEqual([]);
    expect(host.config.get(DISMISSED_KEY)).toEqual({ playcountMissing: HOST_VERSION });

    const again = await start(host);
    await probePlaycount(host, again.store);
    expect(again.kinds()).toEqual([]);

    versionIs(host, '2.1.0');
    const upgraded = await start(host);
    await probePlaycount(host, upgraded.store);
    expect(upgraded.kinds()).toEqual(['playcountMissing']);
  });

  it('关掉的提醒有几条按此刻的插件版本数；恢复后提醒重新出现，config 里的记录清空，下次启动照常提醒', async () => {
    const host = installFakeHost({
      config: { [DISMISSED_KEY]: { libraryNotConfigured: '1.0.0' } },
    });
    const first = await start(host);
    // 旧版本上关掉的那条本来就会再提示，不算。
    expect(first.store.get(dismissedCountAtom)).toBe(0);
    await probePlaycount(host, first.store);
    first.service.dismissReminder('playcountMissing');
    await settle();
    expect(first.store.get(dismissedCountAtom)).toBe(1);
    expect(first.kinds()).toEqual([]);

    first.service.restoreReminders();
    await settle();
    expect(first.store.get(dismissedCountAtom)).toBe(0);
    expect(first.kinds()).toEqual(['playcountMissing']);
    expect(host.config.get(DISMISSED_KEY)).toEqual({});

    const again = await start(host);
    await probePlaycount(host, again.store);
    expect(again.kinds()).toEqual(['playcountMissing']);
  });

  it('问题眼下不在的提醒，关掉过也算一条；一条都没记时恢复不写 config', async () => {
    const host = installFakeHost({
      config: { [DISMISSED_KEY]: { playcountMissing: HOST_VERSION } },
    });
    const { store, service, kinds } = await start(host);
    expect(kinds()).toEqual([]);
    expect(store.get(dismissedCountAtom)).toBe(1);
    service.restoreReminders();
    await settle();
    expect(store.get(dismissedCountAtom)).toBe(0);
    const writes = host.callsTo('config.set').length;
    service.restoreReminders();
    await settle();
    expect(host.callsTo('config.set')).toHaveLength(writes);
  });

  it.each<[string, ConfigValue]>([
    ['不是对象', 'playcountMissing'],
    ['数组', ['playcountMissing']],
    ['版本不是字符串', { playcountMissing: 2 }],
  ])('「不再提示」的存档是坏值（%s）当没有记', async (_, value) => {
    const host = installFakeHost({ config: { [DISMISSED_KEY]: value } });
    const { store, kinds } = await start(host);
    await probePlaycount(host, store);
    expect(kinds()).toEqual(['playcountMissing']);
  });

  it('更新提示随装配层给的状态出现与消失，重启与重试交给更新器', async () => {
    const host = installFakeHost();
    versionIs(host, REQUIRED_HOST_VERSION);
    const store = createStore();
    const notice = atom<UpdateNotice | null>(null);
    const restart = vi.fn(async () => true);
    const check = vi.fn(async () => {});
    const install = vi.fn(async () => {});
    const showChangelog = vi.fn();
    const service = startInfoCenter(
      store,
      REMINDERS,
      host.fb,
      createMemoryConfigWriter(host.fb),
      undefined,
      undefined,
      { notice, restart, check, install, showChangelog },
    );
    onTestFinished(() => service.dispose());
    await service.ready;
    const updates = () =>
      store.get(infoMessagesAtom).filter((message) => message.kind.startsWith('update'));
    expect(updates()).toEqual([]);
    store.set(notice, { kind: 'updatePlugin', latest: '0.3.0', required: '2.4.0' });
    expect(updates()).toEqual([
      { kind: 'updatePlugin', level: 'reminder', params: { latest: '0.3.0', required: '2.4.0' } },
    ]);
    expect(store.get(hasBlockingAtom)).toBe(false);
    service.restartForUpdate();
    service.retryUpdate();
    service.installUpdate();
    service.showChangelog();
    expect(restart).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
    expect(showChangelog).toHaveBeenCalledTimes(1);
    store.set(notice, null);
    expect(updates()).toEqual([]);
    service.dispose();
    service.restartForUpdate();
    service.showChangelog();
    expect(restart).toHaveBeenCalledTimes(1);
    expect(showChangelog).toHaveBeenCalledTimes(1);
  });
});
