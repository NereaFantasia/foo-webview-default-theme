import { fb } from 'foo-webview-sdk/bridge';
import { createTrackArtwork, type TrackArtwork } from '../../src/covers/trackArtwork.ts';
import type { Store } from '../../src/kit/store.ts';

/** 经替身宿主取图的取图接口；在线曲目的展示信息不向后端要，只看已经记下的。 */
export function hostArtwork(store: Store, host: typeof fb = fb): TrackArtwork {
  return createTrackArtwork(store, { want: () => {} }, host);
}
