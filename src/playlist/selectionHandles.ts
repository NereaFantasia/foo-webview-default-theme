import type { PlaylistRef } from 'foo-webview-sdk';
import type { fb } from 'foo-webview-sdk/bridge';
import type { SelectionRanges } from '../table/rangeSelection.ts';

/**
 * 把选中的行号换成宿主 `insertTracks` 收的 `{ path, subsong }`。
 *
 * 选中只有行号，而分窗下未加载的页本地没有行对象，所以一律按区间向宿主分页读，只投影这两个字段；
 * 不走 `getSelectedTracks`——那是整套元数据。调用方先按行数设上限，这里不管大小。
 */

export interface TrackRef {
  path: string;
  subsong: number;
}

export interface HandleReader {
  getTracks: typeof fb.playlist.getTracks;
}

/** 每页行数。按一条路径一二百字节算，一页几十 KB；再大只是让单条消息更长，不省调用。 */
export const HANDLE_PAGE = 500;

export async function collectHandles(
  reader: HandleReader,
  playlist: PlaylistRef,
  ranges: SelectionRanges,
): Promise<TrackRef[]> {
  const out: TrackRef[] = [];
  for (const range of ranges) {
    for (let start = range.start; start < range.end; start += HANDLE_PAGE) {
      const count = Math.min(HANDLE_PAGE, range.end - start);
      const page = await reader.getTracks(playlist, start, count, undefined, ['path', 'subsong']);
      const tracks = page.success ? page.tracks : [];
      // 页比要的短，说明列表在读的途中变短了：行号已经指向别的曲目，宁可整批不发。
      if (tracks.length !== count) throw new Error('playlist changed while reading selection');
      for (const track of tracks) out.push({ path: track.path ?? '', subsong: track.subsong ?? 0 });
    }
  }
  return out;
}
