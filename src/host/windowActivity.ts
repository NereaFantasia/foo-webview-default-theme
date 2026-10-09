import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { windowShellAtom, type WindowShellService } from './windowShell.ts';

export interface WindowActivityState {
  readonly documentVisible: boolean;
  readonly minimized: boolean | null;
  readonly focused: boolean;
}

export interface WindowActivitySource {
  readonly document: Pick<
    Document,
    'hidden' | 'hasFocus' | 'addEventListener' | 'removeEventListener'
  >;
  readonly window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

const stateAtom = atom<WindowActivityState>({
  documentVisible: true,
  minimized: null,
  focused: true,
});

export const windowActivityAtom: Atom<WindowActivityState> = atom((get) => get(stateAtom));

export interface WindowActivityService {
  dispose(): void;
}

export function startWindowActivity(
  store: Store,
  shell: Pick<WindowShellService, 'refreshState'>,
  source: WindowActivitySource | null = typeof document === 'undefined' ||
  typeof window === 'undefined'
    ? null
    : { document, window },
): WindowActivityService {
  let disposed = false;
  let documentVisible = !(source?.document.hidden ?? false);
  let browserFocused = source?.document.hasFocus() ?? true;

  function publish(): void {
    if (disposed) return;
    const host = store.get(windowShellAtom);
    const valid = host.status === 'connected' && host.minimized !== null;
    const minimized = valid ? host.minimized : null;
    const focused = valid ? host.active : browserFocused;
    const previous = store.get(stateAtom);
    if (
      previous.documentVisible !== documentVisible ||
      previous.minimized !== minimized ||
      previous.focused !== focused
    ) {
      store.set(stateAtom, { documentVisible, minimized, focused });
    }
  }

  function onVisibility(): void {
    if (disposed || !source) return;
    const wasVisible = documentVisible;
    documentVisible = !source.document.hidden;
    browserFocused = source.document.hasFocus();
    // 先更新浏览器事实，再撤销宿主旧快照；同步订阅方不应再看到恢复前的可见性。
    if (documentVisible && !wasVisible) void shell.refreshState();
    publish();
  }

  function onFocus(): void {
    if (disposed || !source) return;
    browserFocused = source.document.hasFocus();
    void shell.refreshState();
    publish();
  }

  function onBlur(): void {
    if (disposed || !source) return;
    browserFocused = source.document.hasFocus();
    publish();
  }

  const unsubscribe = store.sub(windowShellAtom, publish);
  source?.document.addEventListener('visibilitychange', onVisibility);
  source?.window.addEventListener('focus', onFocus);
  source?.window.addEventListener('blur', onBlur);
  publish();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      source?.document.removeEventListener('visibilitychange', onVisibility);
      source?.window.removeEventListener('focus', onFocus);
      source?.window.removeEventListener('blur', onBlur);
    },
  };
}
