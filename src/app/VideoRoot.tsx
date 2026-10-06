import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { atom } from 'jotai/vanilla';
import { CapsuleVolume } from '../shell/player/volume/CapsuleVolume.tsx';
import { SeekBar } from '../shell/player/SeekBar.tsx';
import { currentTrackAtom, playbackAtom } from '../playback/playback.ts';
import { displayTitle, nowPlayingAtom } from '../shell/player/now-playing/nowPlaying.ts';
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

export function VideoRoot({
  services,
  children,
}: {
  readonly services: Pick<AppServices, 'store' | 'playback' | 'history'>;
  readonly children: ReactNode;
}) {
  const { store, playback, history } = services;
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
              seekBar: <SeekBar interactive thickness={4} thumb clock />,
              volume: <CapsuleVolume roomy />,
              captions: <CaptionButtons />,
              toggle: () => void playback.playOrPause(),
              previous: () => void playback.previous(),
              next: () => void playback.next(),
              seek: (seconds) => void playback.seek(seconds),
              stepVolume: (up) => void playback.stepVolume(up),
              open: () => history.navigate({ id: 'video' }),
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
