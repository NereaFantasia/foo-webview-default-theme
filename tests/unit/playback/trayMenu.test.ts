import { describe, expect, it } from 'vitest';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import { ORDER_IDS } from '../../../src/playback/playbackOrder.ts';
import {
  buildTrayMenu,
  TRAY_IDS,
  TRAY_TOOLTIP_MAX,
  trayMenuConfig,
  trayTooltipOf,
  truncateForTooltip,
  type TrayIconName,
} from '../../../src/playback/trayMenu.ts';
import { makeTrack } from '../../fixtures/tracks.ts';

const t = createTranslate(zhCN, {});
const icon = (name: TrayIconName) => ({ viewBox: '0 0 24 24', content: `<path d="${name}"/>` });

describe('buildTrayMenu', () => {
  it('三区：歌曲卡留空给宿主补；三个播放键走宿主原生路由；显示主窗口与退出是原生项', () => {
    const { top, playback, bottom } = buildTrayMenu({ t, icon, order: 'default', volume: 50 });
    expect(top).toEqual([{ id: TRAY_IDS.nowPlaying, type: 'nowplaying', label: '未在播放' }]);
    expect(playback.map((item) => item.playbackAction)).toEqual(['previous', 'play-pause', 'next']);
    expect(bottom.map((item) => item.id)).toEqual(['_sys_show', 'volume', 'order', '_sys_exit']);
  });

  it('音量条的值是 0–100 内的整数', () => {
    const volume = (value: number) =>
      buildTrayMenu({ t, icon, order: null, volume: value }).bottom.find(
        (item) => item.id === TRAY_IDS.volume,
      );
    expect(volume(37.6)).toMatchObject({ value: 38, min: 0, max: 100 });
    expect(volume(-5)?.value).toBe(0);
    expect(volume(140)?.value).toBe(100);
  });

  it('顺序一行写当前模式，子菜单七项与宿主同序、只勾当前那项；没读到时不勾', () => {
    const order = (current: (typeof ORDER_IDS)[number] | null) =>
      buildTrayMenu({ t, icon, order: current, volume: 0 }).bottom.find(
        (item) => item.id === TRAY_IDS.order,
      );
    const shuffled = order('shuffle-albums');
    expect(shuffled?.label).toBe('播放顺序 · 乱序（专辑）');
    expect(shuffled?.submenu?.map((item) => item.id)).toEqual(ORDER_IDS);
    expect(shuffled?.submenu?.filter((item) => item.checked).map((item) => item.id)).toEqual([
      'shuffle-albums',
    ]);
    expect(order(null)?.label).toBe('播放顺序');
    expect(order(null)?.submenu?.some((item) => item.checked)).toBe(false);
  });

  it('菜单配置关掉宿主注入的播放键与系统项', () => {
    expect(trayMenuConfig({ dark: true, css: 'x', backdrop: 'acrylic' })).toMatchObject({
      render: 'webview',
      showPlaybackControls: false,
      showSystemItems: false,
      autoNowPlaying: true,
      backdropDarkMode: true,
    });
  });
});

describe('托盘提示', () => {
  it(`最多 ${TRAY_TOOLTIP_MAX} 个 UTF-16 单元，补省略号，不劈开代理对`, () => {
    const long = 'a'.repeat(200);
    expect(truncateForTooltip(long)).toHaveLength(TRAY_TOOLTIP_MAX);
    expect(truncateForTooltip(long).endsWith('…')).toBe(true);
    // 第 127 个单元（下标 126）落在一个表情的低代理上：这个表情整个让出去。
    const emoji = `${'a'.repeat(125)}🎵🎵`;
    const cut = truncateForTooltip(emoji);
    expect(cut).toBe(`${'a'.repeat(125)}…`);
    expect(truncateForTooltip('short')).toBe('short');
  });

  it('写「艺术家 - 标题」，没有曲目时是产品名', () => {
    expect(trayTooltipOf(makeTrack())).toBe('Nujabes - Feather');
    expect(trayTooltipOf(null)).toBe('foobar2000');
  });
});
