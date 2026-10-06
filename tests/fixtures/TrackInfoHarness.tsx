import {
  FluentProvider,
  Button,
  TabList,
  Tab,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Provider, useAtomValueRawSync } from 'jotai/react';
import { atom, createStore } from 'jotai/vanilla';
import type { Track } from 'foo-webview-sdk';
import { TrackInfoPanel } from '../../src/shell/track-info/TrackInfoPanel.tsx';
import { TrackInfoToolbar } from '../../src/shell/track-info/TrackInfoToolbar.tsx';
import { startTrackInfo } from '../../src/shell/track-info/trackInfo.ts';
import { createTrackInfoTarget } from '../../src/shell/track-info/trackInfoTarget.ts';
import { createTranslate } from '../../src/i18n/translate.ts';
import { zhCN } from '../../src/i18n/zhCN.ts';
import { en } from '../../src/i18n/en.ts';
import { lightTheme, darkTheme } from '../../src/theme/themes.ts';
import { INFO_TRACK } from './trackInfoAnswers.ts';
import { makeTrack } from './tracks.ts';
import { startExternalLinkGate } from '../../src/kit/external-link/externalLinkGate.ts';
import { ExternalLinkProvider } from '../../src/kit/external-link/ExternalLinkProvider.tsx';
import { fb } from 'foo-webview-sdk/bridge';
import { startBrowserDataWriter } from '../../src/kit/browserDataStorage.ts';
import { createConfigWriter } from '../../src/host/configWrite.ts';

const store = createStore();
const playing = atom<Track | null>(INFO_TRACK);
const target = createTrackInfoTarget(store, playing);
const active = atom(true);
const service = startTrackInfo(store, { track: target.track, active });
const dataWriter = startBrowserDataWriter();
const links = startExternalLinkGate(store, fb, createConfigWriter(fb, dataWriter));
const t = createTranslate(zhCN, {});
const useStyles = makeStyles({
  root: {
    minHeight: '100dvh',
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingHorizontalM,
    boxSizing: 'border-box',
  },
  pane: {
    width: '320px',
    maxWidth: '100%',
    height: 'calc(100dvh - 32px)',
    display: 'grid',
    gridTemplateRows: 'auto auto auto minmax(0, 1fr)',
    backgroundColor: tokens.colorNeutralBackground2,
  },
});

Reflect.set(window, '__trackInfoHarness', {
  select(value: Partial<Track>) {
    target.select(makeTrack(value));
  },
  play(value: Partial<Track>) {
    store.set(playing, makeTrack(value));
  },
  active(value: boolean) {
    store.set(active, value);
  },
  dispose() {
    service.dispose();
    links.dispose();
    dataWriter.dispose();
  },
});

function Content() {
  const classes = useStyles();
  const visible = useAtomValueRawSync(active);
  const english = new URLSearchParams(location.search).has('en');
  const translate = english ? createTranslate(en, {}) : t;
  return (
    <FluentProvider
      theme={matchMedia('(prefers-color-scheme: dark)').matches ? darkTheme : lightTheme}
    >
      <ExternalLinkProvider service={links}>
        <div className={classes.root}>
          <div className={classes.pane}>
            <div>
              <Button
                size="small"
                onClick={() => {
                  store.set(active, true);
                  target.select(
                    makeTrack({ title: '预览曲目', path: 'file://E:/Music/preview.flac' }),
                  );
                }}
              >
                预览曲目
              </Button>
            </div>
            <TrackInfoToolbar
              service={service}
              target={target}
              t={translate}
              locale={english ? 'en' : 'zh-CN'}
              onClose={() => store.set(active, false)}
            />
            <TabList size="small" selectedValue="info">
              <Tab value="queue" disabled>
                队列
              </Tab>
              <Tab value="lyrics" disabled>
                歌词
              </Tab>
              <Tab value="info">信息</Tab>
              <Tab value="bio" disabled>
                简介
              </Tab>
            </TabList>
            {visible && (
              <TrackInfoPanel
                service={service}
                target={target}
                t={translate}
                locale={english ? 'en' : 'zh-CN'}
              />
            )}
          </div>
        </div>
      </ExternalLinkProvider>
    </FluentProvider>
  );
}

export function TrackInfoHarness() {
  return (
    <Provider store={store}>
      <Content />
    </Provider>
  );
}
