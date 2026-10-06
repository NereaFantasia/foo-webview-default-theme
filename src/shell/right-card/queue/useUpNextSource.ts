import { useAtomValueRawSync } from 'jotai/react';
import { isHostPlaylist } from '../../../host/hostPlaylists.ts';
import { translateAtom } from '../../../i18n/locale.ts';
import { LIBRARY_SOURCE, sourceLabel } from '../../../playback/playbackSource.ts';
import { useRightCard } from '../rightCardContext.ts';
import { upNextAtom } from './upNext.ts';

export interface UpNextSource {
  /** 节头写的来源，如「专辑 · Modal Soul」。 */
  readonly label: string;
  readonly shortLabel: string;
  /** 点节头去来源，进历史。 */
  open(): void;
}

/**
 * 「接下来」节头写的来源。曲目在一张普通播放列表里时写它的名字、点了去那张列表；在主题起播用的专用列表里时
 * 写播放来源（专辑、艺人、歌曲、流派、文件夹），点了去来源的家；来源没有记录，或曲目在宿主自己建的列表里，
 * 写「媒体库」。文字与播放来源用同一套（`sourceLabel`）。专用列表与宿主自己建的列表的名字不出现在界面上。
 */
export function useUpNextSource(): UpNextSource | null {
  const t = useAtomValueRawSync(translateAtom);
  const { deps } = useRightCard();
  const { list } = useAtomValueRawSync(upNextAtom);
  const source = useAtomValueRawSync(deps.source);
  if (!list) return null;
  if (list.name !== deps.libraryList && !isHostPlaylist(list.name)) {
    return {
      label: sourceLabel({ kind: 'playlist', subject: list.guid, name: list.name }, t),
      shortLabel: list.name,
      open: () => deps.openPlaylist(list.guid),
    };
  }
  const shown = source && source.kind !== 'playlist' ? source : LIBRARY_SOURCE;
  const label = sourceLabel(shown, t);
  const name = shown.kind === 'library' ? '' : shown.name;
  return { label, shortLabel: name || label, open: () => deps.openSource() };
}
