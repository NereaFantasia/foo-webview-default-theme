import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPlayback } from '../../../src/playback/playback.ts';
import { chooseVolumeScale, dbOf, positionOf } from '../../../src/playback/volumeScale.ts';
import {
  MENU_COALESCE_MS,
  startTray,
  trayAtom,
  type TrayDeps,
} from '../../../src/playback/tray.ts';
import { watchColorScheme } from '../../../src/theme/colorScheme.ts';
import { startBackdrop } from '../../../src/theme/backdrop.ts';
import { themeFor } from '../../../src/theme/themes.ts';
import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import { fakeMedia } from '../../fixtures/fakeMedia.ts';
import { hostFailure, isRecord } from '../../fixtures/hostAnswers.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const DARK = '(prefers-color-scheme: dark)';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const TRAY_METHODS = ['tray.create', 'tray.setMenuZones', 'tray.setTooltip', 'tray.destroy'];

/** 同时起播放服务与托盘，不等就绪：扣留宿主应答的测试要在中途插手。 */
function launch(host: UnitHost) {
  const store = createStore();
  const media = fakeMedia({ [DARK]: false });
  watchColorScheme(store, media.matchMedia);
  chooseVolumeScale(store, 'db', null);
  const playback = startPlayback(store, host.fb);
  const deps: TrayDeps = {
    playback: { setOrder: vi.fn(async () => {}), setVolume: vi.fn(async () => {}) },
    icon: () => undefined,
    configWriter: createMemoryConfigWriter(host.fb),
  };
  const tray = startTray(store, deps, host.fb);
  const ready = Promise.all([playback.ready, tray.ready]);
  const trayCalls = () => host.calls.filter((call) => TRAY_METHODS.includes(call.method));
  return { store, tray, deps, media, ready, trayCalls };
}

async function start(host: UnitHost) {
  const launched = launch(host);
  await launched.ready;
  await settle();
  return launched;
}

/** 一次 `setMenuZones` 下发的三区各有哪些项的 id。 */
function zonesOf(params: Record<string, unknown> | undefined): Record<string, string[]> {
  const idsOf = (items: unknown) =>
    Array.isArray(items) ? items.map((item) => String(isRecord(item) ? item['id'] : '')) : [];
  return {
    top: idsOf(params?.['top']),
    playback: idsOf(params?.['playback']),
    bottom: idsOf(params?.['bottom']),
  };
}

describe('startTray', () => {
  it.each(['10.0.0', '13.0.0'])(
    '平台版本 %s 的托盘材质跟随系统检测结果',
    async (platformVersion) => {
      const host = installFakeHost();
      vi.stubGlobal('navigator', {
        userAgentData: {
          platform: 'Windows',
          getHighEntropyValues: async () => ({ platformVersion }),
        },
      });
      const { store, tray } = await start(host);
      expect(host.callsTo('tray.setMenuZones').at(-1)?.['config']).toMatchObject({
        backdrop: 'none',
      });
      const backdrop = startBackdrop(store, host.fb, null);
      await backdrop.ready;
      await new Promise((resolve) => setTimeout(resolve, MENU_COALESCE_MS + 30));
      expect(host.callsTo('tray.setMenuZones').at(-1)?.['config']).toMatchObject({
        backdrop: platformVersion === '10.0.0' ? 'none' : 'acrylic',
        css: expect.stringContaining(
          `background: ${platformVersion === '10.0.0' ? themeFor('light').colorNeutralBackground1 : themeFor('light').colorNeutralBackgroundAlpha2}`,
        ),
      });
      backdrop.dispose();
      tray.dispose();
    },
  );

  it('图标最先建，再下发两只开关与菜单：三区与配置一次替换', async () => {
    const host = installFakeHost();
    const { trayCalls } = await start(host);
    expect(trayCalls().map((call) => call.method)).toEqual(['tray.create', 'tray.setMenuZones']);
    expect(host.callsTo('tray.create')).toEqual([{ tooltip: 'foobar2000' }]);
    const [menu] = host.callsTo('tray.setMenuZones');
    expect(zonesOf(menu)).toEqual({
      top: ['np'],
      playback: ['prev', 'playPause', 'next'],
      bottom: ['_sys_show', 'volume', 'order', '_sys_exit'],
    });
    expect(menu?.['config']).toMatchObject({ backdropDarkMode: false, showSystemItems: false });
  });

  it('图标建不成照走后面，只记一笔', async () => {
    const host = installFakeHost();
    host.answer('tray.create', hostFailure('OPERATION_FAILED'));
    const { store } = await start(host);
    expect(store.get(trayAtom).failure).toBe('create');
    expect(host.callsTo('tray.setMenuZones')).toHaveLength(1);
  });

  it(`深浅、顺序这些输入变了整份重发，${MENU_COALESCE_MS} ms 内的变化合成一次`, async () => {
    const host = installFakeHost();
    const { media } = await start(host);
    vi.useFakeTimers();
    host.answer('playback.getPlaybackOrder', {
      success: true,
      order: 3,
      orderIndex: 3,
      orderName: 'random',
      name: 'random',
    });
    host.emit('playback:orderChanged', { order: 3, orderIndex: 3 });
    media.set(DARK, true);
    await vi.advanceTimersByTimeAsync(MENU_COALESCE_MS);
    const menus = host.callsTo('tray.setMenuZones');
    expect(menus).toHaveLength(2);
    expect(menus[1]?.['config']).toMatchObject({ backdropDarkMode: true });
  });

  it('上一次下发还没回来也照发，宿主留后一次；前一次的失败不记，最近一次的才记', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const menus = host.hold('tray.setMenuZones');
    const { store, media, ready } = launch(host);
    await vi.advanceTimersByTimeAsync(0);
    expect(menus.pending).toHaveLength(1);

    media.set(DARK, true);
    await vi.advanceTimersByTimeAsync(MENU_COALESCE_MS);
    expect(menus.pending).toHaveLength(2);
    expect(menus.pending[1]?.['config']).toMatchObject({ backdropDarkMode: true });
    // 宿主按先后作答：前一次的失败先到，那时后一次已经发出。
    menus.respond(0, hostFailure('OPERATION_FAILED'));
    menus.respond(0);
    await ready;
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get(trayAtom).failure).toBeNull();

    menus.release();
    host.answer('tray.setMenuZones', hostFailure('OPERATION_FAILED'));
    media.set(DARK, false);
    await vi.advanceTimersByTimeAsync(MENU_COALESCE_MS);
    expect(store.get(trayAtom).failure).toBe('menu');
  });

  it('页面加载时已在放歌：曲目的初读赶在图标建好之前到，订上之后补发提示', async () => {
    const host = installFakeHost();
    host.answer('playback.getCurrentTrack', { success: true, found: true, track: makeTrack() });
    const create = host.hold('tray.create');
    const { ready } = launch(host);
    await settle();
    expect(create.pending).toEqual([{ tooltip: 'foobar2000' }]);
    create.release();
    await ready;
    await settle();
    expect(host.callsTo('tray.setTooltip')).toEqual([{ tooltip: 'Nujabes - Feather' }]);
  });

  it('提示跟着曲目走，同值不重发', async () => {
    const host = installFakeHost();
    await start(host);
    const track = makeTrack();
    host.emit('playback:trackChanged', track);
    host.emit('playback:edited', { ...track, rating: 4 });
    await settle();
    expect(host.callsTo('tray.setTooltip')).toEqual([{ tooltip: 'Nujabes - Feather' }]);
  });

  it('菜单点击：歌曲卡聚焦主窗，音量条转 dB 设音量，顺序子项按 id 设顺序', async () => {
    const host = installFakeHost();
    const { deps } = await start(host);
    host.emit('tray:menuItemClicked', { id: 'np' });
    host.emit('tray:menuItemClicked', { id: 'volume', value: 70 });
    host.emit('tray:menuItemClicked', { id: 'repeat-track' });
    host.emit('tray:menuItemClicked', { id: 'unknown' });
    await settle();
    expect(host.callsTo('window.focus')).toHaveLength(1);
    expect(deps.playback.setVolume).toHaveBeenCalledWith(-30, false);
    expect(deps.playback.setOrder).toHaveBeenCalledWith('repeat-track');
  });

  it('换了音量刻度：菜单按新刻度重发音量条的位置，之后的拖动也按新刻度换 dB', async () => {
    const host = installFakeHost();
    // 满音量在两种刻度下都在最右端，换一个两种刻度下位置不同的音量。
    host.answer('playback.getVolume', {
      success: true,
      volume: 10,
      volumeDb: -20,
      muted: false,
      isMuted: false,
    });
    const { store, deps } = await start(host);
    const volumeOf = () => {
      const bottom = host.callsTo('tray.setMenuZones').at(-1)?.['bottom'];
      const item = Array.isArray(bottom)
        ? bottom.find((entry) => isRecord(entry) && entry['id'] === 'volume')
        : undefined;
      return isRecord(item) ? item['value'] : undefined;
    };
    expect(volumeOf()).toBe(Math.round(positionOf(-20, 'db')));
    vi.useFakeTimers();
    chooseVolumeScale(store, 'perceptual', null);
    await vi.advanceTimersByTimeAsync(MENU_COALESCE_MS);
    expect(host.callsTo('tray.setMenuZones')).toHaveLength(2);
    expect(volumeOf()).toBe(Math.round(positionOf(-20, 'perceptual')));
    vi.useRealTimers();

    host.emit('tray:menuItemClicked', { id: 'volume', value: 70 });
    await settle();
    expect(deps.playback.setVolume).toHaveBeenCalledWith(dbOf(70, 'perceptual'), false);
  });

  it.each(['visible', 'hidden'] as const)(
    '页面为 %s 时，图标单击与双击均不由主题发起窗口命令',
    async (visibilityState) => {
      vi.stubGlobal('document', { visibilityState });
      const host = installFakeHost();
      await start(host);
      host.emit('tray:click', { button: 0, x: 0, y: 0 });
      host.emit('tray:doubleClick', { x: 0, y: 0 });
      await settle();
      expect(host.calls.filter(({ method }) => method.startsWith('window.'))).toEqual([]);
    },
  );

  it('页面恢复后再收到隐藏期间的图标点击，不会重新最小化', async () => {
    const page = { visibilityState: 'hidden' };
    vi.stubGlobal('document', page);
    const host = installFakeHost();
    await start(host);
    const pendingClicks = [
      { button: 0, x: 10, y: 20 },
      { button: 0, x: 10, y: 20 },
    ];

    // 页面挂起期间的点击，在原生恢复窗口、页面重新可见之后才送达。
    page.visibilityState = 'visible';
    for (const click of pendingClicks) host.emit('tray:click', click);
    await settle();
    expect(host.calls.filter(({ method }) => method.startsWith('window.'))).toEqual([]);
  });

  it('释放时销毁建过的图标', async () => {
    const host = installFakeHost();
    const { tray } = await start(host);
    tray.dispose();
    await settle();
    expect(host.callsTo('tray.destroy')).toHaveLength(1);
    expect(host.listenerCount('tray:menuItemClicked')).toBe(0);
  });

  it('建图标途中释放：图标建成后补销毁，菜单与订阅都不再有', async () => {
    const host = installFakeHost();
    const create = host.hold('tray.create');
    const { tray, ready, trayCalls } = launch(host);
    await settle();
    tray.dispose();
    create.release();
    await ready;
    await settle();
    expect(trayCalls().map((call) => call.method)).toEqual(['tray.create', 'tray.destroy']);
    expect(host.listenerCount('tray:menuItemClicked')).toBe(0);
  });

  it('释放后合并窗口里的变化不再下发', async () => {
    const host = installFakeHost();
    const { tray, media } = await start(host);
    vi.useFakeTimers();
    media.set(DARK, true);
    tray.dispose();
    await vi.advanceTimersByTimeAsync(MENU_COALESCE_MS);
    expect(host.callsTo('tray.setMenuZones')).toHaveLength(1);
    expect(host.callsTo('tray.destroy')).toHaveLength(1);
  });

  it('开关下发失败记一笔；这只开关再下发成功后清掉，别的开关成功不替它清', async () => {
    const host = installFakeHost();
    const { store, tray } = await start(host);
    host.answer('tray.setCloseToTray', hostFailure('OPERATION_FAILED'));
    await tray.setSwitch('closeToTray', true);
    expect(store.get(trayAtom).failure).toBe('closeToTray');

    await tray.setSwitch('minimizeToTray', true);
    expect(store.get(trayAtom).failure).toBe('closeToTray');

    host.answer('tray.setCloseToTray', { success: true });
    await tray.setSwitch('closeToTray', false);
    expect(store.get(trayAtom).failure).toBeNull();
  });

  it('拨开关立即翻转；保存失败另记未保存，不算宿主拒收，再拨存住后清掉', async () => {
    const host = installFakeHost();
    const { store, tray } = await start(host);
    const held = host.hold('config.set');
    const failing = tray.setSwitch('closeToTray', true);
    expect(store.get(trayAtom).switches.closeToTray).toBe(true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0, hostFailure('OPERATION_FAILED'));
    await failing;
    expect(store.get(trayAtom)).toMatchObject({
      failure: null,
      unsaved: { minimizeToTray: false, closeToTray: true },
    });

    held.release();
    await tray.setSwitch('closeToTray', false);
    expect(store.get(trayAtom).unsaved.closeToTray).toBe(false);
    expect(host.config.get('defaultTheme.tray.closeToTray')).toBe(false);
  });

  it('同一只开关连拨两次：先发那次晚到的失败不覆盖后一次的结果', async () => {
    const host = installFakeHost();
    const { store, tray } = await start(host);
    const held = host.hold('config.set');
    const first = tray.setSwitch('minimizeToTray', true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const second = tray.setSwitch('minimizeToTray', false);
    held.respond(0, hostFailure('OPERATION_FAILED'));
    await first;
    expect(store.get(trayAtom).unsaved.minimizeToTray).toBe(false);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0);
    await second;
    expect(store.get(trayAtom)).toMatchObject({
      switches: { minimizeToTray: false },
      unsaved: { minimizeToTray: false },
    });
  });
});
