import { atom, type Atom } from 'jotai/vanilla';
import { fb } from 'foo-webview-sdk/bridge';
import { miniWindowAtom } from '../host/miniWindow.ts';
import type { WindowShellService } from '../host/windowShell.ts';
import { windowActivityAtom } from '../host/windowActivity.ts';
import { registerImmersiveCommands } from '../immersive/page/immersiveKeys.ts';
import { immersiveHostFullscreenAtom } from '../immersive/page/immersivePrefs.ts';
import {
  startImmersiveShell,
  type ImmersiveShell,
  type ImmersiveHost,
} from '../immersive/page/immersiveShell.ts';
import { togglePerfOverlay } from '../immersive/perf/perfOverlay.ts';
import type { ViewServices } from '../immersive/page/viewServices.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import type { CommandRegistry } from '../nav/commandRegistry.ts';
import { historyAtom, type HistoryEntry, type NavHistoryService } from '../nav/navHistory.ts';
import type { PlaybackService } from '../playback/playbackContract.ts';
import { initializeImmersivePrefs } from './immersivePrefs.ts';

interface ImmersiveResources {
  readonly view: Pick<ViewServices, 'spectrum' | 'terrain' | 'stereo'>;
  dispose(): void;
}

export function startImmersiveIntegration(
  store: Store,
  deps: {
    readonly history: Pick<NavHistoryService, 'back' | 'navigate'>;
    readonly commands: CommandRegistry;
    readonly playback: Pick<PlaybackService, 'playOrPause' | 'seek' | 'stepVolume'>;
    /** 视图盖住标题栏的这段时间不向宿主报最大化键的矩形，右上角悬停才不会弹出贴靠布局 */
    readonly windowShell: Pick<WindowShellService, 'coverMaximizeButton'>;
  },
  host: ImmersiveHost = fb,
) {
  const running = atom(true);
  const visible = atom((get) => {
    const activity = get(windowActivityAtom);
    return (
      get(running) &&
      activity.documentVisible &&
      activity.minimized !== true &&
      !get(miniWindowAtom).active
    );
  });
  let disposed = false;
  let session: {
    entry: HistoryEntry;
    shell: ImmersiveShell;
    active: Atom<boolean>;
    end(): void;
    resources?: ImmersiveResources;
  } | null = null;
  let unregister: (() => void) | undefined;

  function syncCommands(): void {
    if (!session || !store.get(session.active)) {
      unregister?.();
      unregister = undefined;
      return;
    }
    unregister ??= registerImmersiveCommands(deps.commands, {
      store,
      playback: deps.playback,
      shell: session.shell,
      togglePerfOverlay: () => togglePerfOverlay(store),
    });
  }

  function endSession(): void {
    const previous = session;
    session = null;
    unregister?.();
    unregister = undefined;
    if (previous) deps.windowShell.coverMaximizeButton(false);
    try {
      previous?.end();
    } finally {
      try {
        previous?.resources?.dispose();
      } finally {
        previous?.shell.dispose();
      }
    }
  }

  const offHistory = store.sub(historyAtom, () => {
    if (session && session.entry !== store.get(historyAtom).entry) endSession();
  });
  const offActive = store.sub(visible, syncCommands);

  return {
    // 沉浸视图的生命周期管理：同一条历史记录只初始化一次；
    // startResources 传 null 时销毁前序取数服务，未传递时保留既有资源
    enter(
      entry: HistoryEntry,
      startResources?: ((active: Atom<boolean>) => ImmersiveResources) | null,
    ) {
      const current = store.get(historyAtom);
      if (disposed || entry !== current.entry || current.place.id !== 'nowPlaying') return null;
      if (session?.entry === entry) {
        if (startResources === null) {
          const stopped = session.resources;
          session.resources = undefined;
          stopped?.dispose();
        } else session.resources ??= startResources?.(session.active);
        return session;
      }
      initializeImmersivePrefs(store);
      const alive = atom(true);
      const active = atom((get) => get(alive) && get(visible) && get(historyAtom).entry === entry);
      const shell = startImmersiveShell(store, {
        host,
        history: deps.history,
        fullscreenOnEnter: () => store.get(immersiveHostFullscreenAtom),
        fullscreenManaged: () => {
          const mini = store.get(miniWindowAtom);
          return mini.active || mini.busy;
        },
        active,
      });
      session = { entry, shell, active, end: () => store.set(alive, false) };
      deps.windowShell.coverMaximizeButton(true);
      session.resources = startResources?.(active);
      syncCommands();
      return session;
    },
    visible,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      offHistory();
      offActive();
      try {
        store.set(running, false);
      } finally {
        endSession();
      }
    },
  };
}

export type ImmersiveIntegration = ReturnType<typeof startImmersiveIntegration>;
export const immersiveIntegrationKey = serviceKey<ImmersiveIntegration>('immersiveIntegration');
