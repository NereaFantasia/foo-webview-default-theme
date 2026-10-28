import { fb } from 'foo-webview-sdk/bridge';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import { trackAbilities } from '../host/trackOrigin.ts';
import { readOnlineAddress } from '../server/onlineAddress.ts';
import type { MusicTrack } from '../server/musicObjects.ts';
import {
  onlineCoverUrl,
  onlineKey,
  onlineTracksAtom,
  type OnlineTracksService,
} from '../playback/onlineTracks.ts';

type HostUrl = typeof fb.artwork.getFb2kUrlByPath;

/** 取展示信息时最多等多久，毫秒；后端没连上时不让取图的一方一直等。 */
const INFO_WAIT_MS = 10000;

/**
 * 取一首曲目的封面地址：播放栏、右侧卡、信息页、沉浸视图、窗口取色与播放列表页都经它取，不各自问宿主。
 * 参数与应答照宿主的 `artwork.getFb2kUrlByPath`。来源不向宿主要封面的（在线曲目，handle 就是占位地址，
 * 宿主对它取不到图）改答上游封面的地址：展示信息还没到时先要，再等它到或等到上限。
 */
export interface TrackArtwork {
  urlOf(...args: Parameters<HostUrl>): ReturnType<HostUrl>;
}

export function createTrackArtwork(
  store: Store,
  tracks: Pick<OnlineTracksService, 'want'>,
  host: { readonly artwork: { readonly getFb2kUrlByPath: HostUrl } } = fb,
): TrackArtwork {
  function infoOf(path: string): Promise<MusicTrack | null> {
    const ref = readOnlineAddress(path)?.ref;
    if (!ref) return Promise.resolve(null);
    const key = onlineKey(ref);
    const known = store.get(onlineTracksAtom);
    if (known.has(key)) return Promise.resolve(known.get(key) ?? null);
    tracks.want([ref]);
    return new Promise((resolve) => {
      const done = () => {
        off();
        clearTimeout(timer);
        resolve(store.get(onlineTracksAtom).get(key) ?? null);
      };
      const off = store.sub(onlineTracksAtom, () => {
        if (store.get(onlineTracksAtom).has(key)) done();
      });
      const timer = setTimeout(done, INFO_WAIT_MS);
    });
  }

  return {
    async urlOf(path, type, options) {
      if (trackAbilities(path).hostArtwork)
        return host.artwork.getFb2kUrlByPath(path, type, options);
      // 上游只给一张封面，当作正面。
      const front = type === undefined || type === 'front';
      const artwork = front ? (await infoOf(path))?.artwork : null;
      return {
        success: true,
        available: !!artwork,
        type: 'front',
        path,
        dataUrl: artwork ? onlineCoverUrl(artwork, options?.maxSize) : '',
      };
    },
  };
}

export const trackArtworkKey = serviceKey<TrackArtwork>('trackArtwork');
