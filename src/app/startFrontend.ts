import { createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from 'jotai/vanilla';
import { startWindowMode, windowModeAtom } from '../host/windowMode.ts';
import { BUILTIN_MESSAGES, createTranslate, resolveBuiltin } from '../i18n/translate.ts';
import { StartupNotice, type StartupNoticeState } from './StartupNotice.tsx';
import { startupOverlay } from './startupOverlay.ts';
import type { AppServices } from './services.ts';

function CommittedRoot({
  children,
  confirm,
}: {
  readonly children: ReactNode;
  readonly confirm: () => Promise<void>;
}) {
  useEffect(() => {
    startupOverlay.dismiss();
    void confirm();
  }, [confirm]);
  return children;
}

/**
 * 先确认运行方式，再加载业务和偏好；面板不会创建写入助手或播放等业务服务。
 * 等待期间由页面里的等待层显示当前步骤，界面挂上或进入说明页时收起。
 */
export function startFrontend(container: HTMLElement) {
  const store = createStore();
  const mode = startWindowMode(store, undefined, import.meta.env.DEV);
  const root = createRoot(container);
  const t = createTranslate(BUILTIN_MESSAGES[resolveBuiltin(navigator.language)], {});
  let disposed = false;
  let starting = false;
  let startFailed = false;
  let panelAcknowledged = false;
  let panelFailed = false;
  let services: AppServices | undefined;

  async function acknowledgePanel(): Promise<void> {
    if (panelAcknowledged) return;
    panelAcknowledged = true;
    try {
      const { clearPanelStartup } = await import('../update/loaderConfirmation.ts');
      if (disposed || (await clearPanelStartup())) return;
    } catch {
      /* 说明页仍保留，失败时提供重新加载。 */
    }
    if (!disposed) {
      panelFailed = true;
      notice('panelUnconfirmed');
    }
  }

  function notice(state: StartupNoticeState): void {
    startupOverlay.dismiss();
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(StartupNotice, {
          state,
          onCommitted: state === 'panel' ? () => void acknowledgePanel() : undefined,
          onRetry: () => {
            if (startFailed || panelFailed) location.reload();
            else void mode.retry();
          },
        }),
      ),
    );
  }

  async function launch(): Promise<void> {
    if (starting || disposed) return;
    starting = true;
    startupOverlay.show(t('startup.loadingUi'));
    try {
      const [{ App }, { startAppServices }] = await Promise.all([
        import('../App.tsx'),
        import('./appServices.ts'),
      ]);
      if (disposed) return;
      startupOverlay.show(t('startup.loadingPrefs'));
      services = await startAppServices();
      if (disposed) {
        services.dispose();
        return;
      }
      off();
      mode.dispose();
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(CommittedRoot, {
            confirm: services.startup.confirm,
            children: createElement(App, { services }),
          }),
        ),
      );
    } catch {
      if (!disposed) {
        startFailed = true;
        notice('startFailed');
      }
    }
  }

  function render(): void {
    if (disposed) return;
    const state = store.get(windowModeAtom);
    if (state === 'checking') startupOverlay.show(t('startup.checking'));
    else if (state === 'standalone' || state === 'preview') void launch();
    else notice(state);
  }
  const off = store.sub(windowModeAtom, render);
  render();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      off();
      mode.dispose();
      root.unmount();
      services?.dispose();
    },
  };
}
