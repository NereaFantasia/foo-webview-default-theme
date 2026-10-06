import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';
import { isHostPlaylist } from '../host/hostPlaylists.ts';
import { enqueuePaths, QUEUE_BATCH } from '../host/queueCommands.ts';
import type { LibraryViewFace } from '../playback/libraryView.ts';

// 一批不在任何播放列表里的曲目（整张专辑、树节点、详情页里选中的行）怎么变成宿主命令。
// 路径是 `trackPathOf` 拼好的。命令一律不乐观更新界面，后果由宿主事件带回来。

export const INSERT_NEXT_BATCH = QUEUE_BATCH;

export interface TrackListFace extends LibraryViewFace {
  playlist: LibraryViewFace['playlist'] & Pick<typeof fb.playlist, 'create'>;
}

/**
 * 「发送到」子菜单的一项，按列表的 GUID 认：菜单开着时列表可能被删、被重排，序号随之指向别的列表，
 * GUID 仍是同一张。锁定的（智能列表也算锁定）置灰。
 */
export interface SendTarget {
  readonly guid: string;
  readonly name: string;
  readonly locked: boolean;
}

/**
 * 「发送到」的目标清单，菜单打开时现读，宿主自己建的那几张不列；读不到就是空的，子菜单只剩「新建」。
 */
export async function readSendTargets(host: {
  playlist: Pick<typeof fb.playlist, 'getAll'>;
}): Promise<SendTarget[]> {
  const all = await settle(() => host.playlist.getAll());
  if (!all || all.success === false) return [];
  return all.playlists
    .filter(({ name }) => !isHostPlaylist(name))
    .map(({ guid, name, isLocked }) => ({ guid, name, locked: isLocked }));
}

/** 按路径插到队首，插播结束后继续原来源。 */
export function queueNext(host: TrackListFace, paths: readonly string[]): Promise<boolean> {
  return enqueuePaths(host, paths, 'next');
}

/** 按路径追加到队尾，不改来源列表。 */
export function queueLast(host: TrackListFace, paths: readonly string[]): Promise<boolean> {
  return enqueuePaths(host, paths, 'last');
}

/** 按 GUID 复制到列表末尾：列表已经删了宿主答 `NOT_FOUND`、锁着答 `LOCKED`，都答 false。 */
async function addToPlaylist(
  host: Pick<TrackListFace, 'library'>,
  paths: readonly string[],
  guid: string,
): Promise<boolean> {
  const answer = await settle(() => host.library.addToPlaylist([...paths], guid));
  return !!answer && answer.success !== false;
}

/** 复制到菜单打开时选的那张列表末尾。 */
export async function sendToPlaylist(
  host: Pick<TrackListFace, 'library'>,
  paths: readonly string[],
  target: SendTarget,
): Promise<boolean> {
  return paths.length > 0 && addToPlaylist(host, paths, target.guid);
}

/** 新建一张列表再复制进去。 */
export async function sendToNewPlaylist(
  host: Pick<TrackListFace, 'playlist' | 'library'>,
  paths: readonly string[],
  name: string,
): Promise<boolean> {
  if (paths.length === 0) return false;
  const created = await settle(() => host.playlist.create(name));
  if (!created || created.success === false) return false;
  return addToPlaylist(host, paths, created.guid);
}
