import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { ConfigWriter } from '../host/configWrite.ts';
import { hostCommand } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import { translateAtom } from '../i18n/locale.ts';
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
 * 托盘：图标与提示、三区自绘菜单和两只开关（`traySwitches.ts`）。
 *
 * 菜单的样式、深浅、文案、勾选与音量条的位置都随整份菜单下发，任一变了就整份重发（音量条与主窗按同一个
 * 刻度换算，换了刻度也重发），合并 `MENU_COALESCE_MS` 内的变化；
 * 三区与配置经 `setMenuZones` 一次替换，宿主按到达先后处理，背靠背的两次留下后一次。
 * 歌曲卡、音量条与顺序子菜单的点击经 `tray:menuItemClicked` 回到页面，深度挂起时不能及时处理。
 * 图标点击不在页面中控制窗口：隐藏期间的点击可能在恢复后才送达，此时的可见性不代表点击时的窗口状态。
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
}

/** 哪一步失败了。托盘不是主窗里的操作面，不出横幅，留给设置页看。 */
export type TrayFailure = 'create' | 'menu' | 'tooltip' | TraySwitch;

export interface TrayState {
  readonly status: 'connecting' | 'connected' | 'disconnected';
  readonly failure: TrayFailure | null;
  readonly switches: TraySwitchValues;
  /** 已经生效、但没存进 config 的开关；下次启动会回到存档里的值。 */
  readonly unsaved: Readonly<Record<TraySwitch, boolean>>;
}

export const MENU_COALESCE_MS = 150;

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
  const offs: (() => void)[] = [];
  const waiter = waitForHost(host);

  const update = (patch: Partial<TrayState>) => {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...patch });
  };
  const connected = () => !disposed && store.get(stateAtom).status === 'connected';
  const fail = (failure: TrayFailure) => update({ failure });

  /** 记下一只开关最近一次改动的结果：拒收进 failure，未保存另记，互不覆盖。 */
  function report(name: TraySwitch, outcome: TraySwitchOutcome): void {
    update({ unsaved: { ...store.get(stateAtom).unsaved, [name]: outcome.unsaved } });
    if (outcome.rejected) fail(name);
    // 这只开关上次没成、这次成了：失败记的就是它，清掉；记着别的失败时不动。
    else if (store.get(stateAtom).failure === name) update({ failure: null });
  }

  async function pushTooltip(): Promise<void> {
    const next = trayTooltipOf(store.get(currentTrackAtom));
    if (!connected() || next === tooltip) return;
    tooltip = next;
    if (!(await hostCommand(() => host.tray.setTooltip(next)))) fail('tooltip');
  }

  /** 按此刻的输入整份下发一次菜单。之后又发了一次时，这一次的失败不记：菜单已由后一次替换。 */
  async function sendMenu(): Promise<void> {
    if (!connected()) return;
    const mine = ++menuSerial;
    const scheme = store.get(colorSchemeAtom);
    const acrylic = store.get(nativeMaterialsAllowedAtom);
    const theme = themeFor(scheme);
    const zones = buildTrayMenu({
      t: store.get(translateAtom),
      icon: deps.icon,
      order: store.get(playbackOrderAtom),
      volume: positionOf(store.get(volumeDbAtom), store.get(volumeScaleAtom)),
    });
    const config = trayMenuConfig({
      backdrop: acrylic ? 'acrylic' : 'none',
      dark: scheme === 'dark',
      // 未启用材质时，菜单面板需要自己提供不透明的中性底。
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
    // 图标先建：其余 tray.* 都挂在它注册的通知区图标上。建不成照走后面，只记一笔。
    tooltip = trayTooltipOf(store.get(currentTrackAtom));
    created = await hostCommand(() => host.tray.create({ tooltip }));
    if (disposed) {
      // 建图标的往返途中释放了：dispose 那时还不知道建没建成，建成了由这里补销毁。
      if (created) void hostCommand(() => host.tray.destroy());
      return;
    }
    if (!created) fail('create');
    offs.push(
      host.on('tray:menuItemClicked', (payload) => onItemClicked(payload.id, payload.value)),
      store.sub(currentTrackAtom, () => void pushTooltip()),
      ...[
        colorSchemeAtom,
        translateAtom,
        playbackOrderAtom,
        volumeDbAtom,
        volumeScaleAtom,
        nativeMaterialsAllowedAtom,
      ].map((input) => store.sub(input, scheduleMenu)),
    );
    // 建图标的往返途中曲目可能已经变了（页面加载时播放服务的初读常在这时到），这期间没人订阅，
    // 订上之后按当前曲目补一次；与建图标时的提示相同就不发。
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
      // 开关先翻到用户选的一边，下发与保存的结果回来再记。
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
      // 页面重建时不销毁就多出一个图标；正常使用里主窗不会走到这里。
      if (created) void hostCommand(() => host.tray.destroy());
    },
  };
}

export const trayKey = serviceKey<TrayService>('tray');
