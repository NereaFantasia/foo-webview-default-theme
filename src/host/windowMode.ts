import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { settle } from './hostCall.ts';
import { waitForHost, type HostReadyFace } from './waitForHost.ts';

/** 读取窗口模式的等待上限，毫秒；SDK 的底层请求可能在超时后才答复。 */
export const WINDOW_MODE_TIMEOUT_MS = 5000;
export type WindowModeState = 'checking' | 'standalone' | 'panel' | 'preview' | 'failed';
export const windowModeAtom = atom<WindowModeState>('checking');

export interface WindowModeFace extends HostReadyFace {
  readonly ui: Pick<typeof fb.ui, 'getMode'>;
}

export interface WindowModeService {
  readonly ready: Promise<void>;
  retry(): Promise<void>;
  dispose(): void;
}

/** 只确认独立窗口才放行业务；允许预览时，等不到宿主才进入预览，读取失败不能据此放行。 */
export function startWindowMode(
  store: Store,
  host: WindowModeFace = fb,
  allowPreview = false,
): WindowModeService {
  let disposed = false;
  let revision = 0;
  let cancel = () => {};

  async function check(): Promise<void> {
    if (disposed) return;
    const mine = ++revision;
    cancel();
    store.set(windowModeAtom, 'checking');
    const waiter = waitForHost(host);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelled = new Promise<null>((resolve) => {
      cancel = () => resolve(null);
    });
    const current = () => !disposed && mine === revision;
    try {
      const connected = await Promise.race([waiter.done, cancelled]);
      if (!current()) return;
      if (!connected) {
        store.set(windowModeAtom, allowPreview ? 'preview' : 'failed');
        return;
      }
      const answer = await Promise.race([
        settle(() => host.ui.getMode()),
        cancelled,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), WINDOW_MODE_TIMEOUT_MS);
        }),
      ]);
      if (!current()) return;
      store.set(
        windowModeAtom,
        !answer || answer.success === false
          ? 'failed'
          : !answer.panelMode && answer.mode === 'standalone'
            ? 'standalone'
            : 'panel',
      );
    } catch {
      if (current()) store.set(windowModeAtom, 'failed');
    } finally {
      waiter.cancel();
      clearTimeout(timer);
    }
  }

  return {
    ready: check(),
    retry: check,
    dispose() {
      disposed = true;
      revision += 1;
      cancel();
    },
  };
}
