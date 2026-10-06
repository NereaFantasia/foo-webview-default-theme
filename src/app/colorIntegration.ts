import { atom } from 'jotai/vanilla';
import {
  startPlayingCover,
  type PlayingCoverInput,
  type PlayingCoverOptions,
} from '../covers/playingCover.ts';
import { currentTrackAtom, playbackAtom, playbackTrackStatusAtom } from '../playback/playback.ts';
import { trackKeyOf } from '../playback/playbackContract.ts';
import type { Store } from '../kit/store.ts';
import { backgroundTransportAtom } from '../theme/background/windowBackground.ts';

const STATUS = atom((get) => get(playbackAtom).status);
const TRANSPORT = atom((get) => {
  const playback = get(playbackAtom);
  const track = get(playbackTrackStatusAtom);
  if (playback.status === 'disconnected' || track === 'failed') return 'stopped';
  return playback.status === 'connecting' || track === 'pending' ? 'pending' : playback.state;
});
const INPUT = atom<PlayingCoverInput>((get) => {
  const status = get(STATUS);
  const trackStatus = get(playbackTrackStatusAtom);
  const track = get(currentTrackAtom);
  return {
    status:
      status === 'disconnected' || trackStatus === 'failed'
        ? 'unavailable'
        : status === 'connected' && trackStatus === 'ready'
          ? 'ready'
          : 'pending',
    key: trackKeyOf(track),
    handle: track?.handle ?? '',
  };
});

export function startColorIntegration(store: Store, options: PlayingCoverOptions = {}) {
  const update = () => store.set(backgroundTransportAtom, store.get(TRANSPORT));
  const off = store.sub(TRANSPORT, update);
  update();
  const covers = startPlayingCover(store, INPUT, options);
  return {
    dispose() {
      off();
      covers.dispose();
    },
  };
}
