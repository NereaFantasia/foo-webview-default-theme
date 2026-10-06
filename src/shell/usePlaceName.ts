import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { playlistsAtom } from '../playback/playlists.ts';
import { placeName, type Place } from '../nav/places.ts';

/** 组件里取地点的名字：列表按 GUID 从此刻的清单里查名字，列表改了名跟着变。 */
export function usePlaceName(): (place: Place) => string {
  const t = useAtomValueRawSync(translateAtom);
  const { items } = useAtomValueRawSync(playlistsAtom);
  return (place) => placeName(place, t, (guid) => items.find((item) => item.guid === guid)?.name);
}
