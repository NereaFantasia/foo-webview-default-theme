import { fb } from 'foo-webview-sdk/bridge';
import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { Provider } from 'jotai';
import { atom, createStore } from 'jotai/vanilla';
import { use } from 'react';
import { createRoot } from 'react-dom/client';
import { UpdateRoot } from '../../src/app/UpdateRoot.tsx';
import { updateNotice } from '../../src/app/updateIntegration.ts';
import { startInfoCenter, infoCenterKey } from '../../src/host/infoCenter.ts';
import { startLocale } from '../../src/i18n/locale.ts';
import { bindService } from '../../src/kit/serviceKey.ts';
import { ServicesContext, serviceMap } from '../../src/kit/useService.ts';
import { startCommandRegistry, commandsKey } from '../../src/nav/commandRegistry.ts';
import { CommandsContext } from '../../src/nav/useCommand.ts';
import { InfoCenterButton } from '../../src/shell/info-center/InfoCenterButton.tsx';
import { UpdateSettingsContext } from '../../src/settings/updateSettingsContext.ts';
import { startChangelogView, changelogViewKey } from '../../src/update/changelogView.ts';
import type { PublishedKey } from '../../src/update/contract.ts';
import {
  confirmedStartupAtom,
  type ConfirmedStartup,
} from '../../src/update/loaderConfirmation.ts';
import { startUpdater, updaterKey } from '../../src/update/updater.ts';
import { createMemoryConfigWriter } from './dataWriter.ts';

function Settings() {
  return use(UpdateSettingsContext);
}

export function mountChangelogPage(keys: readonly PublishedKey[], startup: ConfirmedStartup) {
  const store = createStore();
  const writer = createMemoryConfigWriter(fb);
  const updater = startUpdater(store, { keys, writer, pause: async () => {} });
  const view = startChangelogView(store, updater, writer);
  const commands = startCommandRegistry(window);
  const locale = startLocale(store, fb, 'zh-CN');
  const info = startInfoCenter(
    store,
    { playcountMissing: atom(false), libraryNotConfigured: atom(false) },
    fb,
    writer,
    undefined,
    undefined,
    {
      notice: updateNotice(updater),
      restart: updater.restart,
      check: updater.check,
      install: updater.install,
      showChangelog: view.show,
    },
  );
  const services = serviceMap([
    bindService(updaterKey, updater),
    bindService(changelogViewKey, view),
    bindService(commandsKey, commands),
    bindService(infoCenterKey, info),
  ]);
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  root.render(
    <Provider store={store}>
      <ServicesContext value={services}>
        <CommandsContext value={commands}>
          <FluentProvider
            theme={
              matchMedia('(prefers-color-scheme: dark)').matches ? webDarkTheme : webLightTheme
            }
          >
            <UpdateRoot>
              <Settings />
              <InfoCenterButton />
            </UpdateRoot>
          </FluentProvider>
        </CommandsContext>
      </ServicesContext>
    </Provider>,
  );
  store.set(confirmedStartupAtom, startup);
  window.addEventListener(
    'pagehide',
    () => {
      root.unmount();
      info.dispose();
      view.dispose();
      updater.dispose();
      locale.dispose();
      commands.dispose();
    },
    { once: true },
  );
}
