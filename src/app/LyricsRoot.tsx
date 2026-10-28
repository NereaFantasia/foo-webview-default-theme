import { useAtomValueRawSync } from 'jotai/react';
import {
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { makeStyles, Spinner } from '@fluentui/react-components';
import { translateAtom } from '../i18n/locale.ts';
import { bindService } from '../kit/serviceKey.ts';
import { ServicesContext, serviceMap, useService } from '../kit/useService.ts';
import { lyricsClockKey } from '../lyrics/lyricsClock.ts';
import { lyricsKey } from '../lyrics/lyricsService.ts';
import { lyricsSettingsKey } from '../lyrics/lyricsSettings.ts';
import { desktopLyricsKey } from '../lyrics/desktop/desktopLyrics.ts';
import { lyricsPrefsKey, LYRICS_PREFS_KEY, LYRICS_PRIORITY_KEY } from '../lyrics/lyricsPrefs.ts';
import { lyricsMotionKey, LYRICS_MOTION_KEY } from '../lyrics/lyricsMotion.ts';
import {
  lyricsDisplayKey,
  LYRICS_ALIGN_KEY,
  LYRICS_DISPLAY_KEY,
  LYRICS_TYPOGRAPHY_KEY,
} from '../lyrics/lyricsDisplay.ts';
import { currentTrackAtom, playbackTrackStatusAtom } from '../playback/playback.ts';
import { playbackCanSeekAtom, playbackConnectedAtom } from '../playback/playerAtoms.ts';
import { RightCardLyricsContext } from '../shell/right-card/rightCardContext.ts';
import { SettingsSaveNotice } from '../settings/SettingsSaveNotice.tsx';
import { LyricsSection } from '../settings/LyricsSection.tsx';
import {
  LyricsSettingsContext,
  LyricsSettingsNavigationContext,
} from '../settings/lyricsSettingsContext.ts';
import { lyricsIntegrationKey, type LyricsIntegration } from './lyricsIntegration.ts';
import type { AppServices } from './services.ts';

const LyricsPage = lazy(() =>
  import('../shell/right-card/lyrics/LyricsPage.tsx').then(({ LyricsPage }) => ({
    default: LyricsPage,
  })),
);

const useStyles = makeStyles({
  loading: {
    height: '100%',
    boxSizing: 'border-box',
    paddingTop: 'var(--lyrics-preview-top, 0px)',
  },
});

function LyricsContent({
  integration,
  services,
  onOpenSettings,
}: {
  readonly integration: LyricsIntegration;
  readonly services: AppServices;
  onOpenSettings(): void;
}) {
  const classes = useStyles();
  const t = useAtomValueRawSync(translateAtom);
  const track = useAtomValueRawSync(currentTrackAtom);
  const prefSaves = useAtomValueRawSync(integration.prefs.persistence.state);
  const displaySaves = useAtomValueRawSync(integration.display.persistence.state);
  const archiveSaves = useAtomValueRawSync(integration.archive.persistence.state);
  const saveFailed = [
    ...prefSaves.values(),
    ...displaySaves.values(),
    ...archiveSaves.values(),
  ].some((state) => state.status === 'failed');
  const active = useAtomValueRawSync(integration.active);
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const trackStatus = useAtomValueRawSync(playbackTrackStatusAtom);
  const canSeek = useAtomValueRawSync(playbackCanSeekAtom);
  return (
    <Suspense
      fallback={<Spinner className={classes.loading} size="small" label={t('lyrics.loading')} />}
    >
      <LyricsPage
        title={track?.title ?? ''}
        artist={track?.artist ?? ''}
        album={track?.album ?? ''}
        saveFailed={saveFailed}
        active={active}
        connected={connected}
        trackStatus={trackStatus}
        canSeek={canSeek}
        trackKey={track?.handle ?? ''}
        clock={integration.clock}
        onSeek={(key, seconds) => void integration.seek(key, seconds)}
        onRetryPlayback={services.playback.retry}
        saveNotice={
          <>
            <SettingsSaveNotice
              persistence={integration.prefs.persistence}
              keys={[LYRICS_PREFS_KEY, LYRICS_PRIORITY_KEY]}
            />
            <SettingsSaveNotice
              persistence={integration.display.persistence}
              keys={[LYRICS_DISPLAY_KEY, LYRICS_TYPOGRAPHY_KEY, LYRICS_ALIGN_KEY]}
            />
            <SettingsSaveNotice
              persistence={integration.archive.persistence}
              keys={[...archiveSaves.keys()]}
            />
          </>
        }
        onOpenSettings={onOpenSettings}
      />
    </Suspense>
  );
}

function LyricsSettingsContent({
  integration,
  requested,
  onFocused,
}: {
  readonly integration: LyricsIntegration;
  readonly requested: boolean;
  onFocused(): void;
}) {
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const select = useContext(LyricsSettingsNavigationContext);
  useEffect(() => {
    if (!requested || !select) return;
    select();
    onFocused();
  }, [requested, select, onFocused]);
  return (
    <LyricsSection
      disabled={!connected}
      saveNotice={
        <>
          <SettingsSaveNotice
            persistence={integration.prefs.persistence}
            keys={[LYRICS_PREFS_KEY, LYRICS_PRIORITY_KEY]}
          />
          <SettingsSaveNotice
            persistence={integration.motion.persistence}
            keys={[LYRICS_MOTION_KEY]}
          />
          <SettingsSaveNotice
            persistence={integration.display.persistence}
            keys={[LYRICS_DISPLAY_KEY, LYRICS_TYPOGRAPHY_KEY, LYRICS_ALIGN_KEY]}
          />
        </>
      }
    />
  );
}

export function LyricsRoot({
  services,
  children,
}: {
  readonly services: AppServices;
  readonly children: ReactNode;
}) {
  const parent = useContext(ServicesContext);
  const integration = useService(lyricsIntegrationKey);
  const [settingsRequested, setSettingsRequested] = useState(false);
  const { store, rightCard } = services;
  const openSettings = () => {
    setSettingsRequested(true);
    if (store.get(rightCard.card.view).form !== 'docked') rightCard.card.close();
    services.history.navigate({ id: 'settings' });
  };
  // 桌面歌词的设置键与菜单项经服务要求打开设置，同样跳到「歌词」组
  const desktopRequests = useAtomValueRawSync(useService(desktopLyricsKey).settingsRequests);
  const handledRequests = useRef(desktopRequests);
  const openSettingsRef = useRef(openSettings);
  openSettingsRef.current = openSettings;
  useEffect(() => {
    if (desktopRequests === handledRequests.current) return;
    handledRequests.current = desktopRequests;
    openSettingsRef.current();
  }, [desktopRequests]);
  const bindings = useMemo(() => {
    const map = new Map(parent);
    if (integration) {
      for (const [key, value] of serviceMap([
        bindService(lyricsKey, integration.service),
        bindService(lyricsClockKey, { clock: integration.clock, seek: integration.seek }),
        bindService(lyricsPrefsKey, integration.prefs),
        bindService(lyricsMotionKey, integration.motion),
        bindService(lyricsDisplayKey, integration.display),
        bindService(lyricsSettingsKey, { open: () => openSettingsRef.current() }),
      ]))
        map.set(key, value);
    }
    return map;
  }, [parent, integration]);
  return (
    <ServicesContext value={bindings}>
      <LyricsSettingsContext
        value={
          integration ? (
            <LyricsSettingsContent
              integration={integration}
              requested={settingsRequested}
              onFocused={() => setSettingsRequested(false)}
            />
          ) : null
        }
      >
        <RightCardLyricsContext
          value={
            integration ? (
              <LyricsContent
                integration={integration}
                services={services}
                onOpenSettings={openSettings}
              />
            ) : null
          }
        >
          {children}
        </RightCardLyricsContext>
      </LyricsSettingsContext>
    </ServicesContext>
  );
}
