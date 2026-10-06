import { fb } from 'foo-webview-sdk/bridge';
import type { DragData, DragOutService, DragOutTicket } from '../host/dragOut.ts';
import { settle } from '../host/hostCall.ts';
import type { HostReadyFace } from '../host/waitForHost.ts';
import { fetchAlbumTracks, type AlbumTracksFace } from './albumTracks.ts';
import { albumKeyOf, trackPathOf, type Album } from '../host/libraryContract.ts';

/**
 * 页面里的拖放载荷：拖的是哪几张专辑，JSON 写的专辑键数组。页面里的落点（如侧边栏的播放列表）按它认
 * 专辑拖放，落下时用 `readAlbumDrag` 读出专辑键再取曲目；拖动途中浏览器不许读数据，只看得到类型。
 *
 * 带凭证的拖动落回本窗口时，同一次拖放里还带着宿主附上的真实文件，`Files` 与 `dnd:drop` 都会到。
 * 落点先认这个类型，认到了就不再理会这一次的 `Files` 与 `dnd:drop`，否则同一批曲目会加两遍。
 */
export const ALBUM_DRAG_TYPE = 'application/x-album-keys';

/**
 * 按下一次至多为几张专辑换凭证，几张合起来至多几首；单张不论多少首都换。每按下一次都要逐张向宿主
 * 取曲目、再换一次凭证，而按下比拖起频繁得多：单击封面也要先按下。再多的只做页面内拖放。
 */
export const DRAG_OUT_ALBUM_LIMIT = 8;
export const DRAG_OUT_TRACK_LIMIT = 500;

export type AlbumDragFace = Pick<HostReadyFace, 'isAvailable'> & AlbumTracksFace;

export interface AlbumDragService {
  /**
   * 按下封面时调：这一批能拖出窗口，就对着它取曲目、向宿主换凭证。凭证要在拖动开始之前到手，
   * `dragstart` 里只能同步写；再按下一次（这里或别的拖出源），上一次还没到手的作废。
   */
  prepare(albums: readonly Album[]): void;
  /** 按下之后没有拖起来（单击了）：这一次还在路上的请求作废。 */
  cancel(): void;
  /**
   * `dragstart` 里同步调：写进页面里的载荷；这一批的凭证已经到手就一并交给宿主，拖到资源管理器等
   * 别的程序时带着文件。答有没有带上文件。
   */
  start(dataTransfer: DragData, albums: readonly Album[]): boolean;
  dispose(): void;
}

/** 这一批能不能拖出窗口，按 `DRAG_OUT_ALBUM_LIMIT` 与 `DRAG_OUT_TRACK_LIMIT` 判。 */
export function dragsOut(albums: readonly Album[]): boolean {
  if (albums.length === 1) return true;
  const tracks = albums.reduce((sum, album) => sum + album.trackCount, 0);
  return albums.length <= DRAG_OUT_ALBUM_LIMIT && tracks <= DRAG_OUT_TRACK_LIMIT;
}

/** 凭证记在哪一批名下：起拖时核对拖的正是按下的那一批。 */
function ownerOf(albums: readonly Album[]): string {
  return `albums:${JSON.stringify(albums.map(albumKeyOf))}`;
}

/** 读页面里的拖放载荷；不是专辑拖放或内容坏了答 null。只在 `drop` 里读得到。 */
export function readAlbumDrag(dataTransfer: Pick<DataTransfer, 'getData'>): string[] | null {
  try {
    const parsed: unknown = JSON.parse(dataTransfer.getData(ALBUM_DRAG_TYPE));
    if (!Array.isArray(parsed)) return null;
    const values: unknown[] = parsed;
    const keys = values.filter((value): value is string => typeof value === 'string');
    return keys.length > 0 ? keys : null;
  } catch {
    return null;
  }
}

/** 启动专辑的拖动。拖进页面里的落点靠 `ALBUM_DRAG_TYPE` 载荷，总是有；拖出窗口的凭证经 `dragOut`。 */
export function startAlbumDrag(
  dragOut: DragOutService,
  host: AlbumDragFace = fb,
): AlbumDragService {
  let disposed = false;
  let ticket: DragOutTicket | null = null;

  async function mint(mine: DragOutTicket, albums: readonly Album[]): Promise<void> {
    if (!(await mine.supported()) || !mine.current()) return;
    // 几张一起取，按阅读顺序拼；同一张还在路上的请求 `fetchAlbumTracks` 已经合并。
    const answers = await Promise.all(
      albums.map((album) => settle(() => fetchAlbumTracks(host, album))),
    );
    if (!mine.current()) return;
    const paths: string[] = [];
    for (const rows of answers) {
      if (!rows) return;
      paths.push(...rows.map(trackPathOf));
    }
    await mine.mint(ownerOf(albums), paths);
  }

  return {
    prepare(albums) {
      if (disposed) return;
      ticket = dragOut.claim();
      if (albums.length === 0 || !dragsOut(albums) || !host.isAvailable()) return;
      void mint(ticket, albums);
    },
    cancel() {
      if (ticket?.current()) dragOut.cancel();
      ticket = null;
    },
    start(dataTransfer, albums) {
      dataTransfer.setData(ALBUM_DRAG_TYPE, JSON.stringify(albums.map(albumKeyOf)));
      dataTransfer.effectAllowed = 'copy';
      if (disposed || albums.length === 0) return false;
      return dragOut.apply(dataTransfer, ownerOf(albums));
    },
    dispose() {
      disposed = true;
      if (ticket?.current()) dragOut.cancel();
      ticket = null;
    },
  };
}
