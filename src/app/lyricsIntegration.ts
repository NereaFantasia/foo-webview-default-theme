import { fb, PlaybackClock } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { serviceKey } from '../kit/serviceKey.ts';
import { trackAbilities } from '../host/trackOrigin.ts';
import { startLyricLog } from '../immersive/lyrics/lyricLog.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { startLocalLyrics } from '../lyrics/lyricsLocal.ts';
import { startLyricsMotion } from '../lyrics/lyricsMotion.ts';
import { startLyricsArchive } from '../lyrics/lyricsArchive.ts';
import { startLyricsDisplay } from '../lyrics/lyricsDisplay.ts';
import { startLyricsPrefs } from '../lyrics/lyricsPrefs.ts';
import { startLyrics, type LyricsTarget } from '../lyrics/lyricsService.ts';
import { desktopLyricsPrefAtom } from '../lyrics/desktop/desktopLyricsPrefs.ts';
import { currentTrackAtom } from '../playback/playback.ts';
import { onlineSourceOf } from '../playback/onlineTracks.ts';
import { trackKeyOf } from '../playback/playbackContract.ts';
import { playbackCanSeekAtom, playbackConnectedAtom } from '../playback/playerAtoms.ts';
import type { AppServices } from './services.ts';

const NO_UNBLOCKED: ReadonlySet<string> = new Set();

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
    // 只要平台与 ID，补全与否不相干
    const online = onlineSourceOf(current.path, NO_UNBLOCKED)?.ref;
    return {
      key: trackKeyOf(current),
      handle: current.handle,
      local: trackAbilities(current.path).opensLocally,
      query: {
        title: current.title,
        artists: artistNames(current.artists, current.artist),
        album: current.album,
        albumArtists: artistNames(current.albumArtists, current.albumArtist),
        durationMs: Math.max(0, current.duration * 1000),
        ...(online?.platform === 'wy' ? { neteaseId: online.id } : {}),
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
  // 取词需求包含沉浸视图与开着的桌面歌词，但被沉浸视图遮住的预览播放器仍使用自己的可见状态
  const wanted = atom(
    (get) =>
      get(active) ||
      ((get(immersiveActive) || get(desktopLyricsPrefAtom).open) && get(playbackConnectedAtom)),
  );
  const prefs = startLyricsPrefs(store, host, configWriter);
  const motion = startLyricsMotion(store, host, configWriter);
  const display = startLyricsDisplay(store, host, configWriter);
  const local = startLocalLyrics(store, { host, track, connected: playbackConnectedAtom });
  const archive = startLyricsArchive(store, track, host, configWriter);
  const service = startLyrics(store, {
    host,
    track,
    active: wanted,
    visible,
    connected: playbackConnectedAtom,
    prefs,
    local,
    archive,
  });
  const immersive = startLyricLog(store, {
    lyrics: service,
    active: immersiveActive,
    offset: service.offset,
    display: display.display,
  });
  const history = rightCard.card.history;
  const stopSubjects = (
    ['lyricsSearch', 'lyricsCandidate', 'lyricsDetails', 'lyricsTiming'] as const
  ).map((id) =>
    history.registerSubject(id, { exists: (subject) => subject === store.get(service.subject) }),
  );
  const stopSubject = store.sub(service.subject, () => {
    const place = store.get(rightCard.card.navigation).place;
    if (
      place.id.startsWith('lyrics') &&
      place.subject &&
      place.subject !== store.get(service.subject)
    )
      history.replace({ id: 'lyrics' });
    history.subjectsChanged();
  });
  const clock = new PlaybackClock();
  // 进入沉浸视图时同样重新对准：它看不见的这段时间里时钟没人校准
  const stopActive = [active, immersiveActive].map((viewActive) =>
    store.sub(viewActive, () => {
      if (store.get(viewActive)) void clock.resync();
    }),
  );
  return {
    service,
    prefs,
    motion,
    display,
    archive,
    clock,
    active,
    immersiveActive,
    track,
    async seek(key: string, seconds: number) {
      if (
        disposed ||
        store.get(track)?.key !== key ||
        !store.get(playbackConnectedAtom) ||
        !store.get(playbackCanSeekAtom)
      )
        return;
      await playback.seek(service.seekTime(seconds));
      if (!disposed) await clock.resync();
    },
    dispose() {
      disposed = true;
      document.removeEventListener('visibilitychange', updateVisibility);
      stopActive.forEach((stop) => stop());
      stopSubject();
      stopSubjects.forEach((stop) => stop());
      immersive.dispose();
      service.dispose();
      archive.dispose();
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
