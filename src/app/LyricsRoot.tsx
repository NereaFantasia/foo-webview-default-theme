import { useAtomValueRawSync } from 'jotai/react';
import { lazy, Suspense, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { makeStyles, Spinner } from '@fluentui/react-components';
import { translateAtom } from '../i18n/locale.ts';
import { bindService } from '../kit/serviceKey.ts';
import { ServicesContext, serviceMap, useService } from '../kit/useService.ts';
import { lyricsClockKey } from '../lyrics/lyricsClock.ts';
import { lyricsKey } from '../lyrics/lyricsService.ts';
import { lyricsSettingsKey } from '../lyrics/lyricsSettings.ts';
import { desktopLyricsKey } from '../lyrics/desktop/desktopLyrics.ts';
import { lyricsPrefsKey, LYRICS_PREFS_KEY, LYRICS_PRIORITY_KEY } from '../lyrics/lyricsPrefs.ts';
import { lyricsMotionKey, LYRICS_VIEW_MOTION_KEYS } from '../lyrics/lyricsMotion.ts';
import { lyricsCacheKey, LYRICS_CACHE_PREF_KEY } from '../lyrics/lyricsCache.ts';
import {
  lyricsDisplayKey,
  LYRICS_PROCESSING_KEY,
  LYRICS_VIEW_KEYS,
} from '../lyrics/lyricsDisplay.ts';
import { currentTrackAtom, playbackTrackStatusAtom } from '../playback/playback.ts';
import { playbackCanSeekAtom, playbackConnectedAtom } from '../playback/playerAtoms.ts';
import { RightCardLyricsContext } from '../shell/right-card/rightCardContext.ts';
import { SettingsSaveNotice } from '../settings/SettingsSaveNotice.tsx';
import { LyricsSection } from '../settings/LyricsSection.tsx';
import { LyricsSettingsContext } from '../settings/lyricsSettingsContext.ts';
import { settingsNavKey } from '../settings/settingsNav.ts';
import { lyricsIntegrationKey, type LyricsIntegration } from './lyricsIntegration.ts';
import type { AppServices } from './services.ts';

const LyricsPage = lazy(() =>
  import('../shell/right-card/lyrics/LyricsPage.tsx').then(({ LyricsPage }) => ({
    default: LyricsPage,
  })),
);

/** 主窗口歌词栏写入的显示存档键，保存失败时在歌词栏提示。沉浸视图存档的保存失败只在设置页提示 */
const MAIN_DISPLAY_KEYS = [LYRICS_VIEW_KEYS.main, LYRICS_PROCESSING_KEY];
const DISPLAY_KEYS = [...Object.values(LYRICS_VIEW_KEYS), LYRICS_PROCESSING_KEY];
const MOTION_KEYS = Object.values(LYRICS_VIEW_MOTION_KEYS);

const useStyles = makeStyles({
  loading: {
    height: '100%',
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
  const saveFailed =
    [...prefSaves.values(), ...archiveSaves.values()].some((state) => state.status === 'failed') ||
    MAIN_DISPLAY_KEYS.some((key) => displaySaves.get(key)?.status === 'failed');
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
              keys={MAIN_DISPLAY_KEYS}
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

function LyricsSettingsContent({ integration }: { readonly integration: LyricsIntegration }) {
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  return (
    <LyricsSection
      disabled={!connected}
      saveNotice={
        <>
          <SettingsSaveNotice
            persistence={integration.prefs.persistence}
            keys={[LYRICS_PREFS_KEY, LYRICS_PRIORITY_KEY]}
          />
          <SettingsSaveNotice persistence={integration.motion.persistence} keys={MOTION_KEYS} />
          <SettingsSaveNotice
            persistence={integration.cache.persistence}
            keys={[LYRICS_CACHE_PREF_KEY]}
          />
          <SettingsSaveNotice persistence={integration.display.persistence} keys={DISPLAY_KEYS} />
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
  const settingsNav = useService(settingsNavKey);
  const { store, rightCard } = services;
  const openSettings = () => {
    if (store.get(rightCard.card.view).form !== 'docked') rightCard.card.close();
    settingsNav.open('lyrics');
  };
  // 桌面歌词的设置键与菜单项经服务请求打开设置，同样跳到「歌词」分区
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
        bindService(lyricsCacheKey, integration.cache),
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
        value={integration ? <LyricsSettingsContent integration={integration} /> : null}
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
