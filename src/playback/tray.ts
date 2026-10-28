import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { ConfigWriter } from '../host/configWrite.ts';
import { hostCommand } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import { translateAtom } from '../i18n/locale.ts';
import { readOnlineAddress } from '../server/onlineAddress.ts';
import { onlineCoverUrl, onlineInfoOf, onlineTracksAtom } from './onlineTracks.ts';
import { currentTrackAtom, playbackOrderAtom, volumeDbAtom } from './playback.ts';
import type { PlaybackService } from './playbackContract.ts';
import { isOrderName } from './playbackOrder.ts';
import { dbOf, positionOf, volumeScaleAtom } from './volumeScale.ts';
import { colorSchemeAtom } from '../theme/colorScheme.ts';
import { nativeMaterialsAllowedAtom } from '../theme/backdrop.ts';
import { themeFor } from '../theme/themes.ts';
import type { Store } from '../kit/store.ts';
import {
  buildTrayMenu,
  TRAY_IDS,
  trayMenuConfig,
  trayTooltipOf,
  type TrayIconName,
  type TrayIconSvg,
  type TrayNowPlaying,
} from './trayMenu.ts';
import { trayMenuCss } from './trayMenuStyle.ts';
import {
  createTraySwitches,
  type TraySwitch,
  type TraySwitchFace,
  type TraySwitchOutcome,
  type TraySwitchValues,
} from './traySwitches.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 托盘集成：管理托盘图标、提示文案、三区自绘上下文菜单以及两项设置开关（`traySwitches.ts`）
 *
 * 菜单样式、配色方案、文案、勾选态及音量滑块位置均随完整菜单下发；任一属性变更均在 `MENU_COALESCE_MS` 内防抖后全量重发
 * （音量滑块与主窗口采用同一换算刻度，调整刻度亦触发重发）
 * 三区布局与配置通过 `setMenuZones` 一次性替换，宿主按序处理，连续下发时以后者为准
 * 歌曲卡片、音量条与播放顺序子菜单的点击经 `tray:menuItemClicked` 回传页面，但在深度挂起状态下无法即时处理
 * 托盘图标单击不在页面层直接控制窗口显隐：窗口隐藏期间的点击可能在唤醒后才送达，其可见性不代表用户点击时的真实状态
 */
export interface TrayFace extends HostReadyFace, TraySwitchFace {
  on: typeof fb.on;
  tray: TraySwitchFace['tray'] &
    Pick<typeof fb.tray, 'create' | 'destroy' | 'setTooltip' | 'setMenuZones'>;
  ui: Pick<typeof fb.ui, 'focus'>;
}

export interface TrayDeps {
  readonly playback: Pick<PlaybackService, 'setOrder' | 'setVolume'>;
  readonly icon: (name: TrayIconName) => TrayIconSvg | undefined;
  readonly configWriter: Pick<ConfigWriter, 'set'>;
  /** 桌面歌词的开启状态与锁定状态，对应托盘菜单中的两项勾选标记 */
  readonly desktopLyrics: Atom<{ readonly open: boolean; readonly locked: boolean }>;
}

/** 记录托盘初始化或交互失败的具体阶段；托盘属于系统级外观不弹出横幅，仅供设置页读取 */
export type TrayFailure = 'create' | 'menu' | 'tooltip' | TraySwitch;

export interface TrayState {
  readonly status: 'connecting' | 'connected' | 'disconnected';
  readonly failure: TrayFailure | null;
  readonly switches: TraySwitchValues;
  /** 已在运行时生效但尚未成功持久化至 config 的开关值；下次启动将回退至存档值 */
  readonly unsaved: Readonly<Record<TraySwitch, boolean>>;
}

export const MENU_COALESCE_MS = 150;

/** 歌曲卡的封面框是 44 CSS 像素，按两倍屏要图；图床把边长向上取到 128 一档 */
const NOW_PLAYING_COVER_PX = 88;

/** 在线曲目的歌曲卡内容；本地曲目与没有曲目时是 null，留给宿主补 */
function onlineNowPlaying(store: Store): TrayNowPlaying | null {
  const track = store.get(currentTrackAtom);
  if (!track || !readOnlineAddress(track.path)) return null;
  const info = onlineInfoOf(track.path, store.get(onlineTracksAtom));
  return {
    title: info ? track.title : store.get(translateAtom)('online.unknownTitle'),
    subtitle: info ? track.artist : '',
    cover: info?.artwork ? onlineCoverUrl(info.artwork, NOW_PLAYING_COVER_PX) : '',
  };
}

const NONE_UNSAVED: Readonly<Record<TraySwitch, boolean>> = {
  minimizeToTray: false,
  closeToTray: false,
};

const stateAtom = atom<TrayState>({
  status: 'connecting',
  failure: null,
  switches: { minimizeToTray: false, closeToTray: false },
  unsaved: NONE_UNSAVED,
});

export const trayAtom: Atom<TrayState> = atom((get) => get(stateAtom));

export interface TrayService {
  readonly ready: Promise<void>;
  setSwitch(name: TraySwitch, value: boolean): Promise<void>;
  dispose(): void;
}

export function startTray(store: Store, deps: TrayDeps, host: TrayFace = fb): TrayService {
  const switches = createTraySwitches(host, deps.configWriter);
  store.set(stateAtom, {
    status: 'connecting',
    failure: null,
    switches: switches.values(),
    unsaved: NONE_UNSAVED,
  });
  let disposed = false;
  let created = false;
  let tooltip = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let menuSerial = 0;
  // 上一次下发的歌曲卡内容：在线曲目才有，换了才重发菜单，本地曲目之间换曲不重发
  let sentCard = 'null';
  const offs: (() => void)[] = [];
  const waiter = waitForHost(host);

  const update = (patch: Partial<TrayState>) => {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...patch });
  };
  const connected = () => !disposed && store.get(stateAtom).status === 'connected';
  const fail = (failure: TrayFailure) => update({ failure });

  /** 记录单个开关的最新改动结果：拒绝状态写入 failure，未持久化状态独立保存 */
  function report(name: TraySwitch, outcome: TraySwitchOutcome): void {
    update({ unsaved: { ...store.get(stateAtom).unsaved, [name]: outcome.unsaved } });
    if (outcome.rejected) fail(name);
    // 当前开关此前若处于失败状态且本次成功，清除其 failure 记录；若当前记录为其他故障则保留
    else if (store.get(stateAtom).failure === name) update({ failure: null });
  }

  async function pushTooltip(): Promise<void> {
    const next = trayTooltipOf(store.get(currentTrackAtom));
    if (!connected() || next === tooltip) return;
    tooltip = next;
    if (!(await hostCommand(() => host.tray.setTooltip(next)))) fail('tooltip');
  }

  /** 全量下发当前配置的托盘菜单；若后续已有新菜单下发，当前调用的失败结果自动忽略 */
  async function sendMenu(): Promise<void> {
    if (!connected()) return;
    const mine = ++menuSerial;
    const scheme = store.get(colorSchemeAtom);
    const acrylic = store.get(nativeMaterialsAllowedAtom);
    const theme = themeFor(scheme);
    const nowPlaying = onlineNowPlaying(store);
    sentCard = JSON.stringify(nowPlaying);
    const zones = buildTrayMenu({
      t: store.get(translateAtom),
      nowPlaying,
      icon: deps.icon,
      order: store.get(playbackOrderAtom),
      volume: positionOf(store.get(volumeDbAtom), store.get(volumeScaleAtom)),
      desktopLyrics: store.get(deps.desktopLyrics),
    });
    const config = trayMenuConfig({
      backdrop: acrylic ? 'acrylic' : 'none',
      dark: scheme === 'dark',
      // 未启用材质时，菜单面板需要自己提供不透明的中性底
      css: trayMenuCss(
        acrylic ? theme : { ...theme, colorNeutralBackgroundAlpha2: theme.colorNeutralBackground1 },
        scheme === 'dark',
      ),
    });
    const ok = await hostCommand(() => host.tray.setMenuZones(zones, config));
    if (!ok && mine === menuSerial) fail('menu');
  }

  function scheduleMenu(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void sendMenu();
    }, MENU_COALESCE_MS);
  }

  function onItemClicked(id: string, value: number | undefined): void {
    if (id === TRAY_IDS.nowPlaying) void hostCommand(() => host.ui.focus());
    else if (id === TRAY_IDS.volume && value !== undefined) {
      void deps.playback.setVolume(dbOf(value, store.get(volumeScaleAtom)), false);
    } else if (isOrderName(id)) void deps.playback.setOrder(id);
  }

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed) return;
    if (!arrived) {
      update({ status: 'disconnected' });
      return;
    }
    update({ status: 'connected' });
    // 优先创建托盘图标：其余 tray.* 操作均依赖已注册的通知区图标句柄；创建失败仍继续后续流程并记录故障
    tooltip = trayTooltipOf(store.get(currentTrackAtom));
    created = await hostCommand(() => host.tray.create({ tooltip }));
    if (disposed) {
      // 图标创建往返期间若服务已释放，补发销毁命令以避免托盘残留
      if (created) void hostCommand(() => host.tray.destroy());
      return;
    }
    if (!created) fail('create');
    // 第一份菜单随后就按当前曲目发，订阅从这一刻的内容起比
    sentCard = JSON.stringify(onlineNowPlaying(store));
    offs.push(
      host.on('tray:menuItemClicked', (payload) => onItemClicked(payload.id, payload.value)),
      store.sub(currentTrackAtom, () => {
        void pushTooltip();
        if (JSON.stringify(onlineNowPlaying(store)) !== sentCard) scheduleMenu();
      }),
      ...[
        colorSchemeAtom,
        translateAtom,
        playbackOrderAtom,
        volumeDbAtom,
        volumeScaleAtom,
        nativeMaterialsAllowedAtom,
        deps.desktopLyrics,
      ].map((input) => store.sub(input, scheduleMenu)),
    );
    // 图标创建往返期间曲目可能已发生变更（初读常在此窗口期到达），完成事件监听后按当前曲目补发提示
    void pushTooltip();
    const restored = await switches.restore();
    update({ switches: switches.values() });
    if (restored.minimizeToTray) report('minimizeToTray', restored.minimizeToTray);
    if (restored.closeToTray) report('closeToTray', restored.closeToTray);
    await sendMenu();
  }

  return {
    ready: connect(),
    async setSwitch(name, value) {
      const outcome = switches.set(name, value, connected());
      // 界面侧优先乐观翻转开关，待宿主下发与持久化结果返回后核对同步
      update({ switches: switches.values() });
      const result = await outcome;
      if (result) report(name, result);
    },
    dispose() {
      disposed = true;
      waiter.cancel();
      switches.dispose();
      if (timer !== undefined) clearTimeout(timer);
      for (const off of offs.splice(0)) off();
      // 页面重建时显式销毁托盘图标，避免通知区出现幽灵图标
      if (created) void hostCommand(() => host.tray.destroy());
    },
  };
}

export const trayKey = serviceKey<TrayService>('tray');
