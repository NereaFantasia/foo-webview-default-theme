import { fb, PlaybackClock } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { serviceKey } from '../kit/serviceKey.ts';
import { isLocalMedia } from '../immersive/analysis/localMedia.ts';
import { startLyricLog } from '../immersive/lyrics/lyricLog.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { startLocalLyrics } from '../lyrics/lyricsLocal.ts';
import { startLyricsMotion } from '../lyrics/lyricsMotion.ts';
import { startLyricsDisplay } from '../lyrics/lyricsDisplay.ts';
import { startLyricsPrefs } from '../lyrics/lyricsPrefs.ts';
import { startLyrics, type LyricsTarget } from '../lyrics/lyricsService.ts';
import { currentTrackAtom } from '../playback/playback.ts';
import { trackKeyOf } from '../playback/playbackContract.ts';
import { playbackCanSeekAtom, playbackConnectedAtom } from '../playback/playerAtoms.ts';
import type { AppServices } from './services.ts';

const artistNames = (values: readonly string[] | undefined, fallback: string) =>
  (values?.length ? values : [fallback])
    .flatMap((value) => value.split(', '))
    .map((value) => value.trim())
    .filter(Boolean);

export function startLyricsIntegration(
  {
    store,
    rightCard,
    playback,
    configWriter,
  }: Pick<AppServices, 'store' | 'configWriter'> & {
    readonly rightCard: Pick<AppServices['rightCard'], 'card'>;
    readonly playback: Pick<AppServices['playback'], 'seek'>;
  },
  host: typeof fb = fb,
) {
  let disposed = false;
  const visible = atom(document.visibilityState !== 'hidden');
  const updateVisibility = () => store.set(visible, document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', updateVisibility);
  const track = atom<LyricsTarget | null>((get) => {
    const current = get(currentTrackAtom);
    if (!current) return null;
    return {
      key: trackKeyOf(current),
      handle: current.handle,
      local: isLocalMedia(current.path),
      query: {
        title: current.title,
        artists: artistNames(current.artists, current.artist),
        album: current.album,
        albumArtists: artistNames(current.albumArtists, current.albumArtist),
        durationMs: Math.max(0, current.duration * 1000),
      },
    };
  });
  const active = atom((get) => {
    const view = get(rightCard.card.view);
    return (
      get(visible) &&
      get(playbackConnectedAtom) &&
      get(historyAtom).place.id !== 'nowPlaying' &&
      view.form !== 'none' &&
      view.prefs.page === 'lyrics'
    );
  });
  const immersiveActive = atom((get) => get(visible) && get(historyAtom).place.id === 'nowPlaying');
  // 取词需求包含沉浸视图，但被它遮住的预览播放器仍使用自己的可见状态。
  const wanted = atom((get) => get(active) || (get(immersiveActive) && get(playbackConnectedAtom)));
  const prefs = startLyricsPrefs(store, host, configWriter);
  const motion = startLyricsMotion(store, host, configWriter);
  const display = startLyricsDisplay(store, host, configWriter);
  const local = startLocalLyrics(store, { host, track, connected: playbackConnectedAtom });
  const service = startLyrics(store, {
    host,
    track,
    active: wanted,
    connected: playbackConnectedAtom,
    prefs,
    local,
  });
  const immersive = startLyricLog(store, { lyrics: service, active: immersiveActive });
  const clock = new PlaybackClock();
  const stopActive = store.sub(active, () => {
    if (store.get(active)) void clock.resync();
  });
  return {
    service,
    prefs,
    motion,
    display,
    clock,
    active,
    track,
    async seek(key: string, seconds: number) {
      if (
        disposed ||
        store.get(track)?.key !== key ||
        !store.get(playbackConnectedAtom) ||
        !store.get(playbackCanSeekAtom)
      )
        return;
      await playback.seek(seconds);
      if (!disposed) await clock.resync();
    },
    dispose() {
      disposed = true;
      document.removeEventListener('visibilitychange', updateVisibility);
      stopActive();
      immersive.dispose();
      service.dispose();
      local.dispose();
      prefs.dispose();
      motion.dispose();
      display.dispose();
      clock.dispose();
    },
  };
}

export type LyricsIntegration = ReturnType<typeof startLyricsIntegration>;
export const lyricsIntegrationKey = serviceKey<LyricsIntegration>('lyricsIntegration');
