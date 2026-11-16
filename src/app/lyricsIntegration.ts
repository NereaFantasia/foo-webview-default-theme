import { fb, PlaybackClock } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { serviceKey } from '../kit/serviceKey.ts';
import { trackAbilities } from '../host/trackOrigin.ts';
import { startLyricLog } from '../immersive/lyrics/lyricLog.ts';
import { mainHistoryAtom } from '../nav/navHistory.ts';
import { startLocalLyrics } from '../lyrics/lyricsLocal.ts';
import { startLyricsMotion } from '../lyrics/lyricsMotion.ts';
import { startLyricsArchive } from '../lyrics/lyricsArchive.ts';
import { startLyricsCache } from '../lyrics/lyricsCache.ts';
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
    backend,
  }: Pick<AppServices, 'store' | 'configWriter'> & {
    readonly rightCard: Pick<AppServices['rightCard'], 'card'>;
    readonly playback: Pick<AppServices['playback'], 'seek'>;
    /** 本地后端。未提供时歌词缓存不可用，取词照常进行 */
    readonly backend?: AppServices['backend'];
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
    // 只需要平台与 ID，与曲目信息是否已补全无关
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
      get(mainHistoryAtom).place.id !== 'nowPlaying' &&
      view.form !== 'none' &&
      view.prefs.page === 'lyrics'
    );
  });
  const immersiveActive = atom(
    (get) => get(visible) && get(mainHistoryAtom).place.id === 'nowPlaying',
  );
  // 取词需求包括沉浸视图与已打开的桌面歌词。被沉浸视图遮住的预览播放器仍使用自身的可见状态
  const wanted = atom(
    (get) =>
      get(active) ||
      ((get(immersiveActive) || get(desktopLyricsPrefAtom).open) && get(playbackConnectedAtom)),
  );
  const prefs = startLyricsPrefs(store, host, configWriter);
  const display = startLyricsDisplay(store, host, configWriter);
  const motion = startLyricsMotion(store, host, configWriter, display.views);
  const local = startLocalLyrics(store, { host, track, connected: playbackConnectedAtom });
  const archive = startLyricsArchive(store, track, host, configWriter);
  const cache = startLyricsCache(store, backend, host, configWriter);
  const service = startLyrics(store, {
    host,
    track,
    active: wanted,
    visible,
    connected: playbackConnectedAtom,
    prefs,
    local,
    archive,
    cache,
  });
  const immersive = startLyricLog(store, {
    lyrics: service,
    active: immersiveActive,
    offset: service.offset,
    display: display.immersiveDisplay,
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
  // 进入沉浸视图时同样重新校准时钟：视图不可见期间没有任何一方校准时钟
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
    cache,
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
      cache.dispose();
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
