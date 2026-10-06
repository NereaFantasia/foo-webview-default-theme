import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { historyAtom } from '../nav/navHistory.ts';
import type { AppServices } from './services.ts';
import { startTrackInfo, type TrackInfoHost } from '../shell/track-info/trackInfo.ts';
import type { TrackInfoTarget } from '../shell/track-info/trackInfoTarget.ts';
import type { TableTrack } from '../table/tableItems.ts';

/** 表格省略的字段按 SDK 的未知值表示，不从合并署名反推多值标签。 */
export function infoTrackFromRow(row: TableTrack): Track {
  return {
    ...row,
    artists: [...(row.artists ?? [])],
    albumArtists: [...(row.albumArtists ?? [])],
    albumArtist: row.albumArtist ?? '',
    genre: row.genre ?? '',
    date: row.date ?? '',
    codec: row.codec ?? '',
    bitrate: row.bitrate ?? 0,
    sampleRate: row.sampleRate ?? 0,
    channels: row.channels ?? 0,
    fileSize: row.fileSize ?? -1,
  };
}

export function startTrackInfoIntegration(
  {
    store,
    rightCard,
  }: Pick<AppServices, 'store'> & {
    readonly rightCard: Pick<AppServices['rightCard'], 'card'>;
  },
  target: TrackInfoTarget,
  host: TrackInfoHost = fb,
  documentState: Pick<Document, 'visibilityState'> &
    Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = document,
) {
  const visible = atom(documentState.visibilityState !== 'hidden');
  const updateVisibility = () => store.set(visible, documentState.visibilityState !== 'hidden');
  documentState.addEventListener('visibilitychange', updateVisibility);
  const active = atom((get) => {
    const view = get(rightCard.card.view);
    return (
      get(visible) &&
      get(historyAtom).place.id !== 'nowPlaying' &&
      view.form !== 'none' &&
      view.prefs.page === 'info'
    );
  });
  const service = startTrackInfo(store, { track: target.track, active }, host);
  return {
    service,
    target,
    dispose() {
      documentState.removeEventListener('visibilitychange', updateVisibility);
      service.dispose();
    },
  };
}

export type TrackInfoIntegration = ReturnType<typeof startTrackInfoIntegration>;
