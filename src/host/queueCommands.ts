import { fb } from 'foo-webview-sdk/bridge';
import { settle } from './hostCall.ts';

/**
 * `queue.insertNext` 单批入队上限数量（256 条）
 * 坐标入队模式下宿主上限为 max(256, 队列当前长度)；路径模式沿用相同分批步长，避免单次传入过多路径导致宿主阻塞
 */
export const QUEUE_BATCH = 256;

export interface QueueCommandsFace {
  queue: Pick<typeof fb.queue, 'insertNext' | 'getCount' | 'playNow'>;
  playlist: Pick<typeof fb.playlist, 'getAll' | 'getTracks' | 'playTrack'>;
}

/** 队列插入位置：`next` 插在当前曲目之后（下一首播放），`last` 追加至播放队列末尾 */
export type EnqueuePlace = 'next' | 'last';

/**
 * 按原生路径句柄将一批曲目插入播放队列
 * - 该模式不改变各播放列表内容，队列播放完毕后原列表自动衔接
 * - 若曲目已在队列中，宿主将执行移动而非重复插入
 * - 超过分批上限的请求自动拆分为多批串行提交，中途若单批失败即终止，已成功入队的批次不执行回滚
 */
export async function enqueuePaths(
  host: { queue: Pick<typeof fb.queue, 'insertNext' | 'getCount'> },
  paths: readonly string[],
  place: EnqueuePlace,
  current: () => boolean = () => true,
): Promise<boolean> {
  if (!current() || paths.length === 0) return false;
  let position = 0;
  if (place === 'last') {
    const count = await settle(() => host.queue.getCount());
    if (!current() || count?.success !== true) return false;
    position = count.count;
  }
  for (let start = 0; start < paths.length; start += QUEUE_BATCH) {
    if (!current()) return false;
    const batch = paths.slice(start, start + QUEUE_BATCH);
    const answer = await settle(() => host.queue.insertNext(batch, position));
    if (!current() || answer?.success !== true || answer.invalidCount > 0) return false;
    position += answer.insertedCount + answer.movedCount;
  }
  return true;
}

/**
 * 从指定播放列表的第 `row` 行起播，同时保留已有播放队列
 *
 * 核心的默认动作（`playlist.playTrack` 走的那一条）先清空整个队列。队列不为空时改走两步：按坐标把这一行
 * 插到队首，再 `queue.playNow(0)` 只取走它。带坐标的条目播出时正在播放的列表与续播起点都跟到这一行，
 * 之后先播留着的队列，再从这一行往下。队列为空时照旧 `playTrack`，与宿主的缺省一致
 *
 * 坐标要列表序号，序号在起播前按 GUID 现查：用户刚增删过别的列表时，调用方手里的序号可能已经指到别处
 * 两步之间刚好换曲、核心取走了这条新插的队首，`playNow(0)` 会播到留着的下一条；窗口只有一次往返，接受
 *
 * 行号是调用方早先读到的。给了 `expected`（那一行当时的句柄）时先核一次：列表在这一行之前插进或删掉了行，
 * 这一行已是另一首，不起播、答 false
 */
export async function playKeepingQueue(
  host: QueueCommandsFace,
  guid: string,
  row: number,
  expected?: string,
  current: () => boolean = () => true,
): Promise<boolean> {
  if (!current() || !Number.isInteger(row) || row < 0) return false;
  if (expected !== undefined) {
    const page = await settle(() => host.playlist.getTracks(guid, row, 1, undefined, ['handle']));
    if (!current() || page?.success !== true || page.tracks[0]?.handle !== expected) return false;
  }
  const count = await settle(() => host.queue.getCount());
  if (!current() || count?.success !== true) return false;
  if (count.count === 0) {
    const played = await settle(() => host.playlist.playTrack(guid, row));
    return current() && played?.success === true;
  }
  const all = await settle(() => host.playlist.getAll());
  if (!current() || all?.success !== true) return false;
  const target = all.playlists.find((playlist) => playlist.guid === guid);
  if (!target || row >= target.trackCount) return false;
  const inserted = await settle(() =>
    host.queue.insertNext([{ playlist: target.index, item: row }], 0),
  );
  if (
    !current() ||
    inserted?.success !== true ||
    inserted.invalidCount > 0 ||
    inserted.insertedCount + inserted.movedCount !== 1
  )
    return false;
  const played = await settle(() => host.queue.playNow(0));
  return current() && played?.success === true;
}
