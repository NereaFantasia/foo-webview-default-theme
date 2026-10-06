import type { Track } from 'foo-webview-sdk';
import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';

export type InfoSource = 'playing' | 'preview';

/** 只保存主动选中的曲目；页面卸载或播放换曲不清掉预览。 */
export function createTrackInfoTarget(store: Store, playing: Atom<Track | null>) {
  const preview = atom<Track | null>(null);
  const source = atom<InfoSource>('playing');
  const track: Atom<Track | null> = atom((get) =>
    get(source) === 'preview' ? get(preview) : get(playing),
  );
  return {
    preview: preview as Atom<Track | null>,
    source: source as Atom<InfoSource>,
    playing,
    track,
    select(value: Track) {
      store.set(preview, value);
      store.set(source, 'preview');
    },
    follow(value: InfoSource) {
      if (value === 'playing' || store.get(preview)) store.set(source, value);
    },
  };
}

export type TrackInfoTarget = ReturnType<typeof createTrackInfoTarget>;
