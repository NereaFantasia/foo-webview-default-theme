import { fb } from 'foo-webview-sdk/bridge';
import { useEffect, useState } from 'react';
import { countRows } from '../table/rangeSelection.ts';
import type { PlaylistMenuTarget } from './PlaylistTrackMenu.tsx';
import { readPlaylistMenuTracks, type PlaylistMenuTracks } from './playlistMenuTracks.ts';
import { SEND_TO_INLINE_LIMIT } from './playlistTrackActions.ts';
import { useService } from '../kit/useService.ts';
import { useStore } from 'jotai/react';
import { playlistRowsKey } from './playlistRows.ts';
import { ratingsKey } from '../track/trackRatings.ts';

const EMPTY: PlaylistMenuTracks = { tracks: [], stamps: [] };

export function usePlaylistMenuTracks(guid: string, target: PlaylistMenuTarget | null) {
  const store = useStore();
  const playlistRows = useService(playlistRowsKey);
  const ratings = useService(ratingsKey);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    readonly target: PlaylistMenuTarget;
    readonly data: PlaylistMenuTracks | null;
    readonly attempt: number;
  } | null>(null);
  useEffect(() => {
    if (!target || target.ratingTracks || countRows(target.ranges) > SEND_TO_INLINE_LIMIT) return;
    let disposed = false;
    const current = () =>
      !disposed && store.get(playlistRows.stateOf(guid)).contentVersion === target.contentVersion;
    void readPlaylistMenuTracks(fb.playlist, guid, target.ranges, ratings.stamp, current).then(
      (data) => {
        if (current()) setLoaded({ target, data, attempt });
      },
    );
    return () => {
      disposed = true;
    };
  }, [guid, target, store, playlistRows, ratings, attempt]);
  const result = target && loaded?.target === target && loaded.attempt === attempt ? loaded : null;
  return {
    ...(target?.ratingTracks ?? result?.data ?? EMPTY),
    failed: result?.data === null,
    retry: () => setAttempt((previous) => previous + 1),
  };
}
