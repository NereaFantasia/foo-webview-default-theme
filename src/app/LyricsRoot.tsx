import { useAtomValueRawSync } from 'jotai/react';
import { lazy, Suspense, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Spinner } from '@fluentui/react-components';
import { translateAtom } from '../i18n/locale.ts';
import { bindService } from '../kit/serviceKey.ts';
import { ServicesContext, serviceMap, useService } from '../kit/useService.ts';
import { lyricsKey } from '../lyrics/lyricsService.ts';
import { lyricsPrefsKey, LYRICS_PREFS_KEY } from '../lyrics/lyricsPrefs.ts';
import { lyricsMotionKey, LYRICS_MOTION_KEY } from '../lyrics/lyricsMotion.ts';
import { lyricsDisplayKey, LYRICS_DISPLAY_KEY } from '../lyrics/lyricsDisplay.ts';
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

function LyricsContent({
  integration,
  services,
  onOpenSettings,
}: {
  readonly integration: LyricsIntegration;
  readonly services: AppServices;
  onOpenSettings(): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const track = useAtomValueRawSync(currentTrackAtom);
  const cover = useAtomValueRawSync(services.rightCard.deps.cover);
  const active = useAtomValueRawSync(integration.active);
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const trackStatus = useAtomValueRawSync(playbackTrackStatusAtom);
  const canSeek = useAtomValueRawSync(playbackCanSeekAtom);
  return (
    <Suspense fallback={<Spinner size="small" label={t('lyrics.loading')} />}>
      <LyricsPage
        title={track?.title ?? ''}
        artist={track?.artist ?? ''}
        cover={cover}
        active={active}
        connected={connected}
        trackStatus={trackStatus}
        canSeek={canSeek}
        trackKey={track?.handle ?? ''}
        clock={integration.clock}
        onSeek={(key, seconds) => void integration.seek(key, seconds)}
        onRetryPlayback={services.playback.retry}
        saveNotice={
          <SettingsSaveNotice
            persistence={integration.prefs.persistence}
            keys={[LYRICS_PREFS_KEY]}
          />
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
            persistence={integration.motion.persistence}
            keys={[LYRICS_MOTION_KEY]}
          />
          <SettingsSaveNotice
            persistence={integration.display.persistence}
            keys={[LYRICS_DISPLAY_KEY]}
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
  const bindings = useMemo(() => {
    const map = new Map(parent);
    if (integration) {
      for (const [key, value] of serviceMap([
        bindService(lyricsKey, integration.service),
        bindService(lyricsPrefsKey, integration.prefs),
        bindService(lyricsMotionKey, integration.motion),
        bindService(lyricsDisplayKey, integration.display),
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
                onOpenSettings={() => {
                  setSettingsRequested(true);
                  if (store.get(rightCard.card.view).form !== 'docked') rightCard.card.close();
                  services.history.navigate({ id: 'settings' });
                }}
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
