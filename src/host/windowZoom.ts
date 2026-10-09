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
  /** 0 表示使用本次宿主启动时的默认缩放，其余是百分比。 */
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
 * 页面重载后 getZoom 已是主题设过的值，不能再当作宿主默认值。初始值按窗口保存在宿主进程的内存里，
 * 随进程退出失效；用户选择则单独存浏览器偏好。设置请求串行执行，只保存最后一次选择。
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
