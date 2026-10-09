import type { Track, TraySetMenuZonesParams } from 'foo-webview-sdk';
import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/translate.ts';
import { ORDER_IDS, ORDER_LABEL_KEYS, type OrderName } from './playbackOrder.ts';
import { nowPlayingCaption } from './windowTitle.ts';

/**
 * 托盘菜单的纯逻辑：三区菜单项、菜单配置与提示文字。不碰宿主、不碰 DOM。
 *
 * 三个播放键带 `playbackAction`，由宿主原生执行，页面挂起时也能用。音量条与播放顺序是页面处理的项，
 * 经 `tray:menuItemClicked` 回到页面，页面深挂起时点不动。播放顺序在 fb2k 里是七选一，只给一行，
 * 子菜单七项、勾当前那项。
 */

/** SDK 没从入口导出菜单项与配置的类型，从 `setMenuZones` 的参数上取。 */
export type TrayMenuItem = NonNullable<TraySetMenuZonesParams['top']>[number];
export type TrayMenuConfig = NonNullable<TraySetMenuZonesParams['config']>;
export type TrayIconSvg = NonNullable<TrayMenuItem['iconSvg']>;

/** `_sys_show` 与 `_sys_exit` 是宿主的原生项，页面挂起时也能用，标签照用这里给的。 */
export const TRAY_IDS = {
  nowPlaying: 'np',
  previous: 'prev',
  playPause: 'playPause',
  next: 'next',
  showMainWindow: '_sys_show',
  volume: 'volume',
  order: 'order',
  exit: '_sys_exit',
} as const;

/** 菜单里要用的图标：三键、两条系统项，加七种顺序。图标本体由调用方按名给。 */
export type TrayIconName =
  'previous' | 'playPause' | 'next' | 'showMainWindow' | 'exit' | `order:${OrderName}`;

export interface TrayMenuZones {
  readonly top: TrayMenuItem[];
  readonly playback: TrayMenuItem[];
  readonly bottom: TrayMenuItem[];
}

export interface TrayMenuInput {
  readonly t: Translate;
  readonly icon: (name: TrayIconName) => TrayIconSvg | undefined;
  /** 当前播放顺序；null 是还没读到。 */
  readonly order: OrderName | null;
  /** 音量条的位置，0–100，按用户的刻度换算好。 */
  readonly volume: number;
}

/** `Shell_NotifyIcon` 的 `szTip` 是 128 个 UTF-16 单元，含结尾的 NUL。 */
export const TRAY_TOOLTIP_MAX = 127;

/** 截到 `max` 个 UTF-16 单元以内并补省略号，不劈开代理对。按 UTF-16 数，宿主的上限就是这么算的。 */
export function truncateForTooltip(text: string, max: number = TRAY_TOOLTIP_MAX): string {
  if (text.length <= max) return text;
  let cut = max - 1;
  const code = text.charCodeAt(cut);
  // 切点落在低代理上，就连它前面的高代理一起让出去。
  if (code >= 0xdc00 && code <= 0xdfff) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

export function trayTooltipOf(track: Pick<Track, 'artist' | 'title'> | null): string {
  return truncateForTooltip(nowPlayingCaption(track));
}

function action(
  input: TrayMenuInput,
  id: string,
  label: MessageKey,
  icon: TrayIconName,
  playbackAction: NonNullable<TrayMenuItem['playbackAction']>,
): TrayMenuItem {
  return { id, type: 'normal', label: input.t(label), iconSvg: input.icon(icon), playbackAction };
}

/**
 * 三区菜单项：歌曲卡；上一曲、播放 / 暂停、下一曲；显示主窗口、音量、播放顺序、退出。
 * 歌曲卡的封面与两行字留空，宿主按 `autoNowPlaying` 在菜单打开那一刻补。
 * 音量条的值必须是 [min, max] 内的整数：宿主按整数收，带小数整条菜单都会被拒。
 */
export function buildTrayMenu(input: TrayMenuInput): TrayMenuZones {
  const { t, icon, order } = input;
  const orderLabel = order ? `${t('tray.order')} · ${t(ORDER_LABEL_KEYS[order])}` : t('tray.order');
  return {
    top: [{ id: TRAY_IDS.nowPlaying, type: 'nowplaying', label: t('tray.noTrack') }],
    playback: [
      action(input, TRAY_IDS.previous, 'tray.previous', 'previous', 'previous'),
      action(input, TRAY_IDS.playPause, 'tray.playPause', 'playPause', 'play-pause'),
      action(input, TRAY_IDS.next, 'tray.next', 'next', 'next'),
    ],
    bottom: [
      {
        id: TRAY_IDS.showMainWindow,
        type: 'normal',
        label: t('tray.showMainWindow'),
        iconSvg: icon('showMainWindow'),
      },
      {
        id: TRAY_IDS.volume,
        type: 'slider',
        label: t('tray.volume'),
        value: Math.round(Math.min(100, Math.max(0, input.volume))),
        min: 0,
        max: 100,
      },
      {
        id: TRAY_IDS.order,
        type: 'submenu',
        label: orderLabel,
        iconSvg: icon(`order:${order ?? 'default'}`),
        submenu: ORDER_IDS.map((id) => ({
          id,
          type: 'normal',
          label: t(ORDER_LABEL_KEYS[id]),
          iconSvg: icon(`order:${id}`),
          checked: id === order,
        })),
      },
      { id: TRAY_IDS.exit, type: 'normal', label: t('tray.exit'), iconSvg: icon('exit') },
    ],
  };
}

/** 菜单的配置。宿主注入的播放键与系统项全关：这两组都由这里自己给，再注入就是两份。 */
export function trayMenuConfig(options: {
  readonly dark: boolean;
  readonly css: string;
  readonly backdrop: 'acrylic' | 'none';
}): TrayMenuConfig {
  return {
    render: 'webview',
    layoutMode: 'zones',
    backdrop: options.backdrop,
    backdropDarkMode: options.dark,
    autoNowPlaying: true,
    showPlaybackControls: false,
    showSystemItems: false,
    cssReplace: true,
    css: options.css,
    closeAnimationMs: 0,
  };
}
