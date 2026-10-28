import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { atom } from 'jotai/vanilla';
import { CapsuleVolume } from '../shell/player/volume/CapsuleVolume.tsx';
import { SEEK_FOCUS } from '../shell/player/playerFocus.ts';
import { SeekBar } from '../playback/seek/SeekBar.tsx';
import { currentTrackAtom, playbackAtom } from '../playback/playback.ts';
import { displayTitle, nowPlayingAtom } from '../playback/now-playing/nowPlaying.ts';
import { trackKeyOf } from '../playback/playbackContract.ts';
import { CaptionButtons } from '../shell/CaptionButtons.tsx';
import type { AppServices } from './services.ts';
import { VideoContext, type VideoPlayback } from '../video/videoContext.ts';
import { startVideo, type VideoService } from '../video/videoService.ts';
import styles from './VideoRoot.module.css';
import { VideoEntryContext } from '../nav/videoEntry.ts';
import { VideoEntry } from '../video/VideoEntry.tsx';
import { historyAtom } from '../nav/navHistory.ts';
import { START_PLACE } from '../nav/places.ts';
import { useService } from '../kit/useService.ts';
import { foldersKey } from '../library/folders/foldersServices.ts';
import { objectOpenerKey } from '../nav/objectOpener.ts';

export function VideoRoot({
  services,
  children,
}: {
  readonly services: Pick<AppServices, 'store' | 'playback' | 'history'>;
  readonly children: ReactNode;
}) {
  const { store, playback, history } = services;
  const folders = useService(foldersKey);
  const objects = useService(objectOpenerKey);
  const [service, setService] = useState<VideoService | null>(null);
  const [expanded, expand] = useState(false);
  const closeVideo = () => {
    if (store.get(historyAtom).place.id !== 'video') return;
    if (!history.back()) history.navigate(START_PLACE);
  };
  const state = useMemo(
    () =>
      atom<VideoPlayback>((get) => {
        const value = get(playbackAtom);
        const cover = get(nowPlayingAtom);
        return {
          connected: value.status === 'connected',
          playing: value.state === 'playing',
          canSeek: value.canSeek,
          position: value.position,
          duration: value.duration,
          title: value.track ? displayTitle(value.track) : '',
          cover: cover.key === trackKeyOf(value.track) ? cover.cover : null,
          file: value.track?.absolutePath || null,
        };
      }),
    [],
  );
  useEffect(() => {
    const next = startVideo(store, currentTrackAtom);
    setService(next);
    return () => next.dispose();
  }, [store]);
  return (
    <VideoContext
      value={
        service
          ? {
              service,
              playback: state,
              expanded,
              expand,
              seekBar: <SeekBar interactive thickness={4} thumb clock {...SEEK_FOCUS} />,
              volume: <CapsuleVolume roomy />,
              captions: <CaptionButtons />,
              toggle: () => void playback.playOrPause(),
              previous: () => void playback.previous(),
              next: () => void playback.next(),
              seek: (seconds) => void playback.seek(seconds),
              browse: () => void folders.browseVideo(store.get(state).file),
              reveal: async () => {
                const file = store.get(state).file;
                if (file === null) return false;
                const result = await objects.open({ kind: 'folder', path: file });
                return result === 'done' || result === 'external';
              },
              stepVolume: (up) => void playback.stepVolume(up),
              open: () => history.navigate({ id: 'video' }, 'drill'),
              close: closeVideo,
            }
          : null
      }
    >
      <VideoEntryContext value={<VideoEntry />}>
        <div className={styles.root} inert={expanded}>
          {children}
        </div>
      </VideoEntryContext>
    </VideoContext>
  );
}
