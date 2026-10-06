import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { Provider, useAtomValueRawSync } from 'jotai/react';
import { atom, createStore } from 'jotai/vanilla';
import {
  BiographyOnlineSetting,
  BiographyPanel,
} from '../../src/library/biography/BiographyPanel.tsx';
import type {
  BiographyInput,
  BiographyLanguage,
} from '../../src/library/biography/biographyModel.ts';
import { startBiographyPrefs } from '../../src/library/biography/biographyPrefs.ts';
import { startBiography } from '../../src/library/biography/biographyService.ts';
import { biographyZhCN } from '../../src/i18n/biographyZhCN.ts';
import { readLastfmDetails } from '../../src/library/biography/details/lastfmDetails.ts';
import { readLastfmBiography } from '../../src/library/biography/lastfmBiography.ts';
import { startExternalLinkGate } from '../../src/kit/external-link/externalLinkGate.ts';
import { ExternalLinkProvider } from '../../src/kit/external-link/ExternalLinkProvider.tsx';
import { startLocale } from '../../src/i18n/locale.ts';
import { fb } from 'foo-webview-sdk/bridge';
import { startBrowserDataWriter } from '../../src/kit/browserDataStorage.ts';
import { createConfigWriter } from '../../src/host/configWrite.ts';

const store = createStore();
const dataWriter = startBrowserDataWriter();
const configWriter = createConfigWriter(fb, dataWriter);
const links = startExternalLinkGate(store, fb, configWriter);
const locale = startLocale(store, fb, undefined, dataWriter);
const artist = atom('Queen');
const language = atom<BiographyLanguage>('zh');
const active = atom(true);
const prefs = startBiographyPrefs(store, fb, configWriter);
const input = atom<BiographyInput>((get) => ({
  artist: get(artist),
  language: get(language),
  sourceArtist:
    get(prefs.state).identities.find((item) => item.artist === get(artist))?.sourceArtist ?? null,
}));
const service = startBiography(store, {
  input,
  active,
  enabled: atom((get) => get(prefs.state).enabled),
});

Reflect.set(window, '__biographyHarness', {
  parseDetails: readLastfmDetails,
  parseBiography: readLastfmBiography,
  select(value: string) {
    store.set(artist, value);
  },
  language(value: BiographyLanguage) {
    store.set(language, value);
  },
  active(value: boolean) {
    store.set(active, value);
  },
  dispose() {
    service.dispose();
    prefs.dispose();
    links.dispose();
    locale.dispose();
    dataWriter.dispose();
  },
});

function Content() {
  const name = useAtomValueRawSync(artist);
  const lang = useAtomValueRawSync(language);
  return (
    <FluentProvider
      theme={matchMedia('(prefers-color-scheme: light)').matches ? webLightTheme : webDarkTheme}
    >
      <ExternalLinkProvider service={links}>
        <main style={{ width: '100%', maxWidth: 360, minHeight: 500 }}>
          <BiographyOnlineSetting prefs={prefs} t={(key) => biographyZhCN[key]} />
          <BiographyPanel
            artist={name}
            language={lang}
            service={service}
            prefs={prefs}
            t={(key) => biographyZhCN[key]}
          />
        </main>
      </ExternalLinkProvider>
    </FluentProvider>
  );
}

export function BiographyHarness() {
  return (
    <Provider store={store}>
      <Content />
    </Provider>
  );
}
