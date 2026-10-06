import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { hostCommand } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import { currentTrackAtom } from './playback.ts';
import type { Store } from '../kit/store.ts';

/**
 * 窗口标题跟着曲目：任务栏按钮与 Alt+Tab 上显示「艺术家 - 标题」，停止或没有曲目时是产品名。
 * 宿主自己不写它，否则一直是 `foobar2000`。
 */
export interface WindowTitleFace extends HostReadyFace {
  ui: Pick<typeof fb.ui, 'setTitle'>;
}

/** 页面可见性只用到这两样；缺省包 `document`。 */
export interface VisibilityFace {
  visible(): boolean;
  onChange(listener: () => void): () => void;
}

/** 没有曲目时的标题与托盘提示；它是产品名，不进语言包。 */
export const APP_NAME = 'foobar2000';
/** 收尾去抖，毫秒：连续换曲只写最后一首。 */
export const TITLE_DEBOUNCE_MS = 300;

/** 「艺术家 - 标题」；缺艺术家只写标题；两者都缺或没有曲目时是产品名。暂停着的那首照样算。 */
export function nowPlayingCaption(track: Pick<Track, 'artist' | 'title'> | null): string {
  if (!track) return APP_NAME;
  return [track.artist, track.title].filter((part) => part !== '').join(' - ') || APP_NAME;
}

function documentVisibility(): VisibilityFace {
  return {
    visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
    onChange(listener) {
      if (typeof document === 'undefined') return () => {};
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}

/**
 * 启动窗口标题。页面深挂起（最小化、隐藏到托盘、锁屏）时这里不运行，标题停在挂起那一刻；
 * 恢复可见时不等去抖，按当前曲目立即补写。没连上宿主一次都不调；面板模式下宿主答失败，不重试。
 */
export function startWindowTitle(
  store: Store,
  host: WindowTitleFace = fb,
  visibility: VisibilityFace = documentVisibility(),
): { readonly ready: Promise<void>; dispose(): void } {
  let disposed = false;
  let connected = false;
  let applied = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waiter = waitForHost(host);

  const current = () => nowPlayingCaption(store.get(currentTrackAtom));
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  // 同值不发；失败不记，下一次换曲会再写，标题不值得报错。
  function apply(title: string): void {
    if (disposed || !connected || title === applied) return;
    applied = title;
    void hostCommand(() => host.ui.setTitle(title));
  }

  function schedule(): void {
    clear();
    if (current() === applied) return;
    timer = setTimeout(() => {
      timer = undefined;
      apply(current());
    }, TITLE_DEBOUNCE_MS);
  }

  const offTrack = store.sub(currentTrackAtom, schedule);
  const offVisibility = visibility.onChange(() => {
    if (!visibility.visible()) return;
    clear();
    apply(current());
  });

  async function connect(): Promise<void> {
    if (!(await waiter.done) || disposed) return;
    connected = true;
    // 连上时可能早就在放了，不等下一次换曲。
    schedule();
  }

  return {
    ready: connect(),
    dispose() {
      clear();
      waiter.cancel();
      offTrack();
      offVisibility();
      // 把标题还给宿主的缺省，别让最后一首歌的名字留在窗口上。
      if (connected && applied !== '' && applied !== APP_NAME) {
        void hostCommand(() => host.ui.setTitle(APP_NAME));
      }
      disposed = true;
    },
  };
}
