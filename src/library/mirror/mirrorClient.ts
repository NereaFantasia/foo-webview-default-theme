import type { BackendConnection } from '../../server/backendConnection.ts';
import {
  readMirrorAlbums,
  readMirrorApply,
  readMirrorArtists,
  readMirrorGeneration,
  readMirrorOrder,
  readMirrorPage,
  readMirrorRow,
  readMirrorStatus,
  type LibraryMirrorAction,
  type MirrorAlbum,
  type MirrorApplyReply,
  type MirrorApplyRequest,
  type MirrorArtist,
  type MirrorOrder,
  type MirrorOrderRequest,
  type MirrorPage,
  type MirrorPageRequest,
  type MirrorRow,
  type MirrorStatus,
  type MirrorTrack,
} from '../../server/libraryMirrorProtocol.ts';

/** 整库重建收尾要在后端排秩，十万行约两秒，其余写入远快于此 */
const WRITE_TIMEOUT_MS = 60000;
/** 读取卡住时页面不能一直等，超时就退回宿主；后端正在收尾重建时一次读取最多排队几秒 */
const READ_TIMEOUT_MS = 15000;

export interface MirrorClient {
  status(): Promise<MirrorStatus>;
  apply(request: MirrorApplyRequest): Promise<MirrorApplyReply>;
  /** 开始整库重建，返回这一轮的代次 */
  rebuildBegin(): Promise<number>;
  rebuildPut(generation: number, rows: readonly MirrorTrack[], indexFrom: number): Promise<void>;
  rebuildCommit(generation: number, epoch: string, revision: number): Promise<void>;
  page(request: MirrorPageRequest): Promise<MirrorPage>;
  order(request: MirrorOrderRequest): Promise<MirrorOrder>;
  rows(handles: readonly string[]): Promise<MirrorRow[]>;
  albums(): Promise<MirrorAlbum[]>;
  artists(): Promise<MirrorArtist[]>;
  clear(): Promise<void>;
}

/**
 * 本地后端媒体库镜像的请求封装。后端没连着、请求失败、答复形状不合格都以异常报出，由调用方退回宿主查询
 */
export function createMirrorClient(backend: Pick<BackendConnection, 'request'>): MirrorClient {
  const send = (
    action: LibraryMirrorAction,
    body: unknown = {},
    timeoutMs = READ_TIMEOUT_MS,
  ): Promise<unknown> => backend.request(`/library/${action}`, body, { timeoutMs });
  const need = <T>(value: T | null): T => {
    if (value === null) throw new Error('媒体库镜像的答复不合格');
    return value;
  };
  return {
    async status() {
      return need(readMirrorStatus(await send('status')));
    },
    async apply(request) {
      return need(readMirrorApply(await send('apply', request, WRITE_TIMEOUT_MS)));
    },
    async rebuildBegin() {
      return need(readMirrorGeneration(await send('rebuild-begin', {}, WRITE_TIMEOUT_MS)));
    },
    async rebuildPut(generation, rows, indexFrom) {
      await send('rebuild-put', { generation, rows, indexFrom }, WRITE_TIMEOUT_MS);
    },
    async rebuildCommit(generation, epoch, revision) {
      await send('rebuild-commit', { generation, epoch, revision }, WRITE_TIMEOUT_MS);
    },
    async page(request) {
      return need(readMirrorPage(await send('page', request)));
    },
    async order(request) {
      return need(readMirrorOrder(await send('order', request), request.paths));
    },
    async rows(handles) {
      const reply: unknown = await send('rows', { handles });
      const rows = typeof reply === 'object' && reply !== null ? Reflect.get(reply, 'rows') : null;
      if (!Array.isArray(rows)) throw new Error('媒体库镜像的答复不合格');
      return rows.map((row) => need(readMirrorRow(row)));
    },
    async albums() {
      return need(readMirrorAlbums(await send('albums')));
    },
    async artists() {
      return need(readMirrorArtists(await send('artists')));
    },
    async clear() {
      await send('clear', {}, WRITE_TIMEOUT_MS);
    },
  };
}
