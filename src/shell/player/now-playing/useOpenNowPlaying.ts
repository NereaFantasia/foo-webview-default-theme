import { useAtomValueRawSync } from 'jotai/react';
import type { Place } from '../../../nav/places.ts';
import { playbackConnectedAtom } from '../../../playback/playerAtoms.ts';
import { useService } from '../../../kit/useService.ts';
import { historyKey } from '../../../nav/navHistory.ts';

const NOW_PLAYING: Place = { id: 'nowPlaying' };

/**
 * 进正在播放全屏页（沉浸视图）：三种播放栏的封面与底部通栏的沉浸键共用。没连上宿主时答 null，调用方把键置灰；
 * 停止时照样能进，页面上各格写「—」。
 */
export function useOpenNowPlaying(): (() => void) | null {
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const history = useService(historyKey);
  return connected ? () => history.navigate(NOW_PLAYING) : null;
}
