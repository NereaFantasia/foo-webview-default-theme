import type { SelectionRanges } from '../table/rangeSelection.ts';
import { countRows } from '../table/rangeSelection.ts';
import { collectHandles } from './selectionHandles.ts';
import { SEND_TO_INLINE_LIMIT } from './playlistTrackActions.ts';

/** 读取前订阅来源变化，防止行缓存合并事件期间仍接受旧路径；宿主未提供跨调用原子快照 */
export async function playPlaylistSelection(
  host: Pick<typeof fb, 'playlist' | 'on'>,
  guid: string,
  ranges: SelectionRanges,
  current: () => boolean,
  play: (paths: readonly string[]) => Promise<boolean>,
): Promise<boolean> {
  const count = countRows(ranges);
  if (!current() || count === 0 || count > SEND_TO_INLINE_LIMIT) return false;
  let changed = false;
  const invalidate = () => {
    changed = true;
  };
  const offs = [
    ...(
      [
        'playlist:itemsAdded',
        'playlist:itemsRemoved',
        'playlist:itemsReordered',
        'playlist:itemsReplaced',
      ] as const
    ).map((event) =>
      host.on(event, ({ playlistGuid }) => {
        if (playlistGuid === guid) invalidate();
      }),
    ),
    host.on('playlist:removed', invalidate),
  ];
  try {
    const tracks = await collectHandles(host.playlist, guid, ranges);
    if (changed || !current()) return false;
    return await play(
      tracks.map((track) =>
        track.subsong ? `${track.path}|subsong:${track.subsong}` : track.path,
      ),
    );
  } catch {
    return false;
  } finally {
    for (const off of offs) off();
  }
}
import type { fb } from 'foo-webview-sdk/bridge';
