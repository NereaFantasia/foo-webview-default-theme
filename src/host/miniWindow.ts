import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import { hostCommand, settle } from './hostCall.ts';
import { waitForHost, type HostReadyFace } from './waitForHost.ts';
import type { WindowShellService } from './windowShell.ts';
import { BROWSER_ENV, createMiniPlacement, type MiniWindowEnv } from './miniPlacement.ts';
import {
  readMiniWindowSnapshot,
  saveMiniWindowSnapshot,
  type MiniWindowSnapshot,
  type MiniWindowStorage,
} from './miniWindowSnapshot.ts';

export type MiniPlayerForm = 'compact' | 'cover';
export interface MiniWindowState {
  readonly active: boolean;
  readonly busy: boolean;
  readonly form: MiniPlayerForm;
  readonly menu: boolean;
  readonly pinned: boolean;
  readonly failure: 'enter' | 'restore' | 'resize' | 'pin' | 'save' | null;
}

const INITIAL: MiniWindowState = {
  active: false,
  busy: false,
  form: 'compact',
  menu: false,
  pinned: false,
  failure: null,
};
export const miniWindowAtom = atom<MiniWindowState>(INITIAL);
/** 界面整体缩放的倍数：版式按下面的尺寸排，窗口取尺寸乘它，字号、按键与封面一同等比缩小。 */
export const MINI_PLAYER_SCALE = 0.875;
/** 缩放前的尺寸，CSS 像素。 */
export const MINI_PLAYER_SIZE = {
  compact: { width: 380, height: 152 },
  cover: { width: 320, height: 456 },
} as const;
/** 紧凑态打开更多菜单时临时增高到这里；封面态的菜单换下封面，尺寸不变。 */
export const MINI_MENU_HEIGHT = 292;

export interface MiniWindowFace extends HostReadyFace {
  readonly ui: Pick<
    typeof fb.ui,
    | 'getMode'
    | 'getState'
    | 'getBounds'
    | 'getMinSize'
    | 'getMaxSize'
    | 'isResizable'
    | 'setResizable'
    | 'setBounds'
    | 'setMinSize'
    | 'setMaxSize'
    | 'restore'
    | 'maximize'
    | 'setFullscreen'
    | 'setAlwaysOnTop'
    | 'startDrag'
    | 'center'
  >;
}

export interface MiniWindowService {
  readonly ready: Promise<void>;
  enter(): Promise<void>;
  leave(): Promise<void>;
  setForm(form: MiniPlayerForm): Promise<void>;
  setMenu(open: boolean): Promise<void>;
  togglePin(): Promise<void>;
  /**
   * 拖动窗口：在主键按下的那一刻调用，宿主接着按标题栏拖动处理，松手后才应答，这时记下新位置。
   * 迷你态不用 CSS 拖动区，拖动区里的指针归宿主，页面收不到悬停。
   */
  drag(): void;
  dismissFailure(): void;
  dispose(): void;
}

export function startMiniWindow(
  store: Store,
  storage: MiniWindowStorage,
  shell: Pick<WindowShellService, 'setTitlebarHeight' | 'setMaximizeButtonRegion'>,
  host: MiniWindowFace = fb,
  environment: Partial<MiniWindowEnv> = {},
): MiniWindowService {
  const env: MiniWindowEnv = { ...BROWSER_ENV, ...environment };
  const placement = createMiniPlacement(host, storage, env);
  let snapshot: MiniWindowSnapshot | null = readMiniWindowSnapshot(storage);
  let disposed = false;
  const waiter = waitForHost(host);
  store.set(miniWindowAtom, { ...INITIAL, active: !!snapshot, busy: !!snapshot });
  const state = () => store.get(miniWindowAtom);
  const update = (patch: Partial<MiniWindowState>) => {
    if (!disposed) store.set(miniWindowAtom, { ...state(), ...patch });
  };
  const command = async (call: () => Promise<{ success: boolean }>) => {
    if (disposed || !(await hostCommand(call))) throw new Error('窗口操作未完成');
    if (disposed) throw new Error('窗口服务已释放');
  };

  async function restore(): Promise<void> {
    const saved = snapshot;
    if (!saved) return;
    await command(() => host.ui.setFullscreen(false));
    await command(() => host.ui.restore());
    await command(() => host.ui.setMaxSize(0, 0));
    await command(() => host.ui.setMinSize(0, 0));
    await command(() => host.ui.setBounds(saved.bounds));
    await command(() => host.ui.setMinSize(saved.min.width, saved.min.height));
    await command(() => host.ui.setMaxSize(saved.max.width, saved.max.height));
    await command(() => host.ui.setResizable(saved.resizable));
    await command(() => host.ui.setAlwaysOnTop(saved.pinned));
    if (saved.maximized) await command(() => host.ui.maximize());
    if (saved.fullscreen) await command(() => host.ui.setFullscreen(true));
    const cleared = await saveMiniWindowSnapshot(storage, null);
    if (!disposed) {
      snapshot = null;
      update({ active: false, menu: false, failure: cleared ? null : 'save' });
    }
  }

  /**
   * 换尺寸。`recall` 为真（进入时）把窗口放回上次记下的位置；没记过或平时贴着离屏幕边近的那一角伸缩：
   * 靠下的往上长，靠右的往左长。
   */
  async function resize(form: MiniPlayerForm, menu: boolean, recall = false): Promise<void> {
    const size = MINI_PLAYER_SIZE[form];
    const ratio = env.pixelRatio() * MINI_PLAYER_SCALE;
    const width = Math.round(size.width * ratio);
    const height = Math.round(
      (menu && form === 'compact' ? MINI_MENU_HEIGHT : size.height) * ratio,
    );
    const remembered = recall ? placement.recalled(width, height) : null;
    const place = remembered ?? (await placement.anchored(width, height));
    await command(() => host.ui.setMinSize(0, 0));
    await command(() => host.ui.setBounds(place ? { ...place, width, height } : { width, height }));
    await command(() => host.ui.setMinSize(width, height));
    if (remembered) await placement.keepOnScreen();
    update({ form, menu });
  }

  async function enter(): Promise<void> {
    if (disposed || state().busy || state().active) return;
    update({ busy: true, failure: null });
    try {
      const mode = await settle(() => host.ui.getMode());
      if (!mode?.success || mode.panelMode || mode.windowId !== 'main') throw new Error('非主窗口');
      const [window, min, max, resizable] = await Promise.all([
        settle(() => host.ui.getState()),
        settle(() => host.ui.getMinSize()),
        settle(() => host.ui.getMaxSize()),
        settle(() => host.ui.isResizable()),
      ]);
      if (disposed) return;
      if (!window?.success || !min?.success || !max?.success || !resizable?.success)
        throw new Error('无法读取窗口状态');
      snapshot = {
        bounds: { x: window.x, y: window.y, width: window.width, height: window.height },
        min: { width: min.width, height: min.height },
        max: { width: max.width, height: max.height },
        maximized: window.maximized,
        fullscreen: window.fullscreen,
        pinned: window.alwaysOnTop,
        resizable: resizable.resizable,
      };
      if (!(await saveMiniWindowSnapshot(storage, snapshot))) {
        snapshot = null;
        update({ failure: 'save' });
        return;
      }
      if (disposed) return;
      update({ active: true, pinned: window.alwaysOnTop });
      if (window.fullscreen) await command(() => host.ui.setFullscreen(false));
      const normal = await settle(() => host.ui.getState());
      if (!normal?.success) throw new Error('无法读取普通窗口状态');
      snapshot = { ...snapshot, maximized: normal.maximized };
      if (normal.maximized || normal.minimized) await command(() => host.ui.restore());
      const bounds = await settle(() => host.ui.getBounds());
      if (!bounds?.success || disposed) throw new Error('无法读取窗口位置');
      snapshot = { ...snapshot, bounds };
      if (!(await saveMiniWindowSnapshot(storage, snapshot))) throw new Error('无法保存窗口位置');
      shell.setMaximizeButtonRegion({ x: 0, y: 0, width: 0, height: 0 });
      shell.setTitlebarHeight(24);
      await command(() => host.ui.setMaxSize(0, 0));
      await command(() => host.ui.setResizable(false));
      await resize(state().form, false, true);
    } catch {
      if (!disposed) {
        try {
          await restore();
          update({ failure: 'enter' });
        } catch {
          update({ active: true, failure: 'restore' });
        }
      }
    } finally {
      update({ busy: false });
    }
  }

  async function leave(): Promise<void> {
    if (disposed || state().busy || !state().active) return;
    update({ busy: true, failure: null });
    try {
      await placement.remember(false);
      await restore();
    } catch {
      update({ failure: 'restore' });
    } finally {
      update({ busy: false });
    }
  }

  async function change(form: MiniPlayerForm, menu: boolean): Promise<void> {
    if (disposed || state().busy || !state().active) return;
    const previous = state();
    update({ busy: true, failure: null });
    try {
      await resize(form, menu);
    } catch {
      try {
        await resize(previous.form, previous.menu);
      } catch {
        // 恢复记录仍在，用户可以返回完整窗口。
      }
      update({ failure: 'resize' });
    } finally {
      update({ busy: false });
    }
  }

  async function connect() {
    const ready = await waiter.done;
    if (disposed) return;
    if (snapshot && ready) {
      try {
        await restore();
      } catch {
        update({ failure: 'restore' });
      }
    }
    update({ busy: false });
  }

  return {
    ready: connect(),
    enter,
    leave,
    setForm: (form) => change(form, false),
    setMenu: (menu) => change(state().form, menu),
    async togglePin() {
      if (disposed || state().busy || !state().active) return;
      update({ busy: true, failure: null });
      const pinned = !state().pinned;
      const ok = await hostCommand(() => host.ui.setAlwaysOnTop(pinned));
      update(ok ? { pinned, busy: false } : { busy: false, failure: 'pin' });
    },
    drag() {
      if (disposed || !state().active) return;
      void hostCommand(() => host.ui.startDrag()).then((ok) => {
        if (ok && !disposed && state().active) return placement.remember(true);
      });
    },
    dismissFailure: () => update({ failure: null }),
    dispose() {
      disposed = true;
      waiter.cancel();
    },
  };
}

export const miniWindowKey = serviceKey<MiniWindowService>('miniWindow');
