import { fb } from 'foo-webview-sdk/bridge';
import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { Provider } from 'jotai';
import { atom, createStore } from 'jotai/vanilla';
import { createRoot } from 'react-dom/client';
import { PluginUpdateRow } from '../../src/app/PluginUpdateRow.tsx';
import { startLocale } from '../../src/i18n/locale.ts';
import { bindService } from '../../src/kit/serviceKey.ts';
import { ServicesContext, serviceMap } from '../../src/kit/useService.ts';
import { SettingsLayoutContext } from '../../src/settings/useSettingsLayout.ts';
import type { PluginTransactionStatus } from '../../src/server/pluginProtocol.ts';
import type { BackendStatus } from '../../src/update/backendBootstrap.ts';
import type { PublishedKey } from '../../src/update/contract.ts';
import {
  confirmedStartupAtom,
  type ConfirmedStartup,
} from '../../src/update/loaderConfirmation.ts';
import { startPluginUpdater, pluginUpdaterKey } from '../../src/update/pluginUpdater.ts';
import { startUpdater } from '../../src/update/updater.ts';
import { createMemoryConfigWriter } from './dataWriter.ts';

const REQUESTS: string[] = [];
export function pluginRequests(): readonly string[] {
  return [...REQUESTS];
}

export function mountPluginUpdatePage(
  keys: readonly PublishedKey[],
  startup: ConfirmedStartup,
  prepared: PluginTransactionStatus,
  scenario: 'install' | 'stale' | 'rollback' = 'install',
): void {
  REQUESTS.length = 0;
  const store = createStore();
  const updater = startUpdater(store, {
    keys,
    writer: createMemoryConfigWriter(fb),
    pause: async () => {},
  });
  const backend = {
    status: atom<BackendStatus>({
      phase: 'ready',
      version: startup.session.version.v,
      runtime: '24.16.0',
    }),
  };
  const connection = {
    async request(path: string): Promise<unknown> {
      REQUESTS.push(path);
      if (path === '/plugin/status')
        return scenario === 'rollback'
          ? { ...prepared, phase: 'rolledBack', error: '启动确认超时' }
          : null;
      if (path === '/plugin/prepare') return prepared;
      if (path === '/plugin/start')
        return {
          ...prepared,
          id: scenario === 'stale' ? startup.installId : prepared.id,
          phase: 'waitingExit',
          running: true,
          attempt: 'c'.repeat(64),
        };
      return { success: true };
    },
  };
  const service = startPluginUpdater(store, updater, backend, connection, {
    keys,
    pause: async () => {},
  });
  const locale = startLocale(store, fb, 'zh-CN');
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  root.render(
    <Provider store={store}>
      <ServicesContext value={serviceMap([bindService(pluginUpdaterKey, service)])}>
        <FluentProvider
          theme={matchMedia('(prefers-color-scheme: dark)').matches ? webDarkTheme : webLightTheme}
        >
          <SettingsLayoutContext value={{ compact: innerWidth < 480 }}>
            <PluginUpdateRow />
          </SettingsLayoutContext>
        </FluentProvider>
      </ServicesContext>
    </Provider>,
  );
  store.set(confirmedStartupAtom, startup);
  void service.check();
  window.addEventListener(
    'pagehide',
    () => {
      root.unmount();
      service.dispose();
      updater.dispose();
      locale.dispose();
    },
    { once: true },
  );
}
