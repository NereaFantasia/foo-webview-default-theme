import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';

export interface VideoFullscreen {
  readonly owned: boolean;
  toggle(): Promise<boolean>;
  leave(): Promise<boolean>;
  dispose(): void;
}

export function startVideoFullscreen(
  host: Pick<typeof fb.ui, 'isFullscreen' | 'enterFullscreen' | 'exitFullscreen'> = fb.ui,
): VideoFullscreen {
  let owned = false;
  let disposed = false;
  let tail = Promise.resolve(false);

  function queue(run: () => Promise<boolean>): Promise<boolean> {
    tail = tail.then(run, run);
    return tail;
  }

  async function leave(): Promise<boolean> {
    if (!owned) return true;
    const result = await settle(() => host.exitFullscreen());
    if (!result || result.success === false) return false;
    owned = false;
    return true;
  }

  return {
    get owned() {
      return owned;
    },
    toggle: () =>
      queue(async () => {
        if (disposed) return false;
        if (owned) return leave();
        const current = await settle(() => host.isFullscreen());
        if (disposed || !current || current.success === false) return false;
        // 已经由别处进入全屏时只改变页面形态，不取得退出宿主全屏的所有权。
        if (current.isFullscreen) return true;
        const result = await settle(() => host.enterFullscreen());
        if (!result || result.success === false || !result.isFullscreen) return false;
        owned = true;
        if (disposed) await leave();
        return !disposed;
      }),
    leave: () => queue(leave),
    dispose() {
      disposed = true;
      void queue(leave);
    },
  };
}
