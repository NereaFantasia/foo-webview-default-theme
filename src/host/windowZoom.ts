import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { defineLocalPref, type PrefStorage } from '../kit/localPref.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { hostCommand, settle } from './hostCall.ts';
import { waitForHost, type HostReadyFace } from './waitForHost.ts';

export const ZOOM_CHOICES = [0, 50, 75, 100, 125, 150, 175, 200] as const;
export const ZOOM_STORAGE_KEY = 'default-theme.zoom.v1';
const pref = defineLocalPref<number>({
  key: ZOOM_STORAGE_KEY,
  fallback: 0,
  parse: (value) => ZOOM_CHOICES.find((choice) => String(choice) === value),
  format: String,
});

export interface WindowZoomState {
  readonly status: 'connecting' | 'ready' | 'failed' | 'unavailable';
  /** 缩放选项百分比数值；0 表示跟随本次启动时宿主默认缩放比例 */
  readonly choice: number;
  readonly pending: boolean;
  readonly failed: boolean;
}

const INITIAL: WindowZoomState = { status: 'connecting', choice: 0, pending: false, failed: false };
const stateAtom = atom<WindowZoomState>(INITIAL);
export const windowZoomAtom: Atom<WindowZoomState> = atom((get) => get(stateAtom));

export interface WindowZoomFace extends HostReadyFace {
  readonly ui: Pick<typeof fb.ui, 'getZoom' | 'setZoom' | 'getCurrentWindowId'>;
  readonly sharedState: Pick<typeof fb.sharedState, 'get' | 'set'>;
}

function validZoom(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 5;
}

/**
 * 启动窗口缩放管理服务
 * 宿主默认基准比例按窗口 ID 缓存于宿主共享内存中（随进程退出失效），避免重载后读取到已被主题修改的值；
 * 用户显式设置的比例持久化至本地偏好中。更新请求全局串行处理，仅最后一次生效
 */
export function startWindowZoom(
  store: Store,
  host: WindowZoomFace = fb,
  storage?: PrefStorage | null,
) {
  const saved = pref.load(store, storage);
  store.set(stateAtom, { ...INITIAL, choice: saved });
  const waiter = waitForHost(host);
  let disposed = false;
  let initialZoom = 1;
  let appliedZoom = 1;
  let requested: number | null = null;
  let running = false;
  const update = (patch: Partial<WindowZoomState>) => {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...patch });
  };

  async function flush(): Promise<void> {
    if (running || disposed || store.get(stateAtom).status !== 'ready') return;
    running = true;
    while (!disposed && requested !== null) {
      const choice = requested;
      requested = null;
      const answer = await settle(() => host.ui.setZoom(choice === 0 ? initialZoom : choice / 100));
      if (disposed) break;
      if (answer && answer.success !== false) appliedZoom = answer.zoom;
      if (requested !== null) continue;
      if (answer && answer.success !== false) {
        pref.set(store, choice, storage);
        update({ choice, pending: false, failed: false });
      } else {
        const current = await settle(() => host.ui.getZoom());
        if (disposed) break;
        if (requested !== null) continue;
        if (current && current.success !== false && validZoom(current.zoom))
          appliedZoom = current.zoom;
        const actual = appliedZoom === initialZoom ? 0 : Math.round(appliedZoom * 100);
        update({ choice: actual, pending: false, failed: true });
      }
    }
    running = false;
  }

  async function connect(): Promise<void> {
    if (!(await waiter.done)) {
      update({ status: 'unavailable' });
      return;
    }
    if (disposed) return;
    const [current, window] = await Promise.all([
      settle(() => host.ui.getZoom()),
      settle(() => host.ui.getCurrentWindowId()),
    ]);
    if (disposed) return;
    if (
      !current ||
      current.success === false ||
      !validZoom(current.zoom) ||
      !window ||
      window.success === false
    ) {
      update({ status: 'failed' });
      return;
    }
    const key = `defaultTheme.zoom.initial.${window.windowId}`;
    appliedZoom = current.zoom;
    const cached = await settle(() => host.sharedState.get(key));
    if (disposed) return;
    if (!cached || cached.success === false) {
      update({ status: 'failed' });
      return;
    }
    initialZoom = cached.exists && validZoom(cached.value) ? cached.value : current.zoom;
    if (
      (!cached.exists || !validZoom(cached.value)) &&
      !(await hostCommand(() => host.sharedState.set(key, initialZoom, true)))
    ) {
      update({ status: 'failed' });
      return;
    }
    if (disposed) return;
    update({ status: 'ready' });
    if (saved !== 0 || current.zoom !== initialZoom) {
      requested = saved;
      update({ pending: true });
      await flush();
    }
  }

  return {
    ready: connect(),
    choose(choice: number): void {
      if (
        disposed ||
        store.get(stateAtom).status !== 'ready' ||
        !ZOOM_CHOICES.some((value) => value === choice)
      )
        return;
      requested = choice;
      update({ pending: true, failed: false });
      void flush();
    },
    dispose(): void {
      disposed = true;
      waiter.cancel();
      requested = null;
    },
  };
}

export const windowZoomKey = serviceKey<ReturnType<typeof startWindowZoom>>('windowZoom');
