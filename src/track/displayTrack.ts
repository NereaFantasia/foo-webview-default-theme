import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import type { Translate } from '../i18n/translate.ts';
import { useService } from '../kit/useService.ts';
import {
  onlineInfoOf,
  onlineKey,
  onlineTracksAtom,
  onlineTracksKey,
  withOnlineTrack,
} from '../playback/onlineTracks.ts';
import type { MusicTrack } from '../server/musicObjects.ts';
import { readOnlineAddress } from '../server/onlineAddress.ts';
import { trackDisplayTitle } from './trackDisplayTitle.ts';

type Shown = Pick<Track, 'path' | 'title' | 'artist' | 'artists' | 'album' | 'duration'>;

export interface DisplayTrack<T> {
  /** 在线曲目套上展示信息后的曲目；其余原样 */
  readonly track: T;
  /** 界面上写的标题。在线曲目还没有展示信息时写「未知曲目」：这时占位地址只能解出平台 ID，不当曲名显示 */
  readonly title: string;
}

/**
 * 一首宿主报来的曲目在界面上怎么写：队列行、右侧卡头、队列菜单的菜单头都经这里，不各自套在线信息
 * 不改宿主的曲目对象本身：在线信息晚到时，调用方按 `onlineTracksAtom` 重算即可
 */
export function displayOf<T extends Shown>(
  track: T,
  online: ReadonlyMap<string, MusicTrack | null>,
  t: Translate,
): DisplayTrack<T> {
  const shown = withOnlineTrack(track, online);
  const pending = readOnlineAddress(track.path) !== null && !onlineInfoOf(track.path, online);
  return { track: shown, title: pending ? t('online.unknownTitle') : trackDisplayTitle(shown) };
}

/** 同 `displayOf`；在线曲目的展示信息还没取过时向后端要一次。没有曲目时标题为空串 */
export function useDisplayTrack<T extends Shown>(track: T): DisplayTrack<T>;
export function useDisplayTrack<T extends Shown>(track: T | null): DisplayTrack<T | null>;
export function useDisplayTrack<T extends Shown>(track: T | null): DisplayTrack<T | null> {
  const t = useAtomValueRawSync(translateAtom);
  const online = useAtomValueRawSync(onlineTracksAtom);
  const service = useService(onlineTracksKey);
  const path = track?.path ?? '';
  const ref = readOnlineAddress(path)?.ref;
  const known = ref ? online.has(onlineKey(ref)) : true;
  useEffect(() => {
    const wanted = readOnlineAddress(path)?.ref;
    if (wanted && !known) service.want([wanted]);
  }, [service, path, known]);
  return track ? displayOf(track, online, t) : { track: null, title: '' };
}
