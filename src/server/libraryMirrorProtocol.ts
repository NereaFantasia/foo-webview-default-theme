/** 媒体库镜像的请求动作；页面与后端共用，路径是 `/library/<动作>` */
export const LIBRARY_MIRROR_ACTIONS = [
  'status',
  'apply',
  'rebuild-begin',
  'rebuild-put',
  'rebuild-commit',
  'page',
  'order',
  'rows',
  'albums',
  'artists',
  'clear',
] as const;
export type LibraryMirrorAction = (typeof LIBRARY_MIRROR_ACTIONS)[number];

/** 镜像文件的结构版本：字段变了就加一并换文件名，旧文件不迁移 */
export const LIBRARY_MIRROR_SCHEMA = 1;
/** 后端读一个镜像请求体的上限，字节；每批行约 1 MiB */
export const LIBRARY_MIRROR_BODY_LIMIT = 8 * 1024 * 1024;
/** 一次请求最多带的行数与句柄数 */
export const MIRROR_ITEMS_PER_REQUEST = 5000;
/** 一次 `page` 最多取的行数 */
export const MIRROR_PAGE_LIMIT = 5000;
/** 一次 `order` 最多取的条数：只带句柄（与路径），一页比整行小得多 */
export const MIRROR_ORDER_LIMIT = 20000;

/** 镜像能排的列，与 `TRACK_SORT` 的列同名；`added`、`playCount`、`lastPlayed` 要播放统计，不在镜像里 */
export const MIRROR_SORT_COLUMNS = [
  'number',
  'title',
  'artist',
  'album',
  'albumArtist',
  'year',
  'genre',
  'rating',
  'duration',
  'codec',
  'bitrate',
  'sampleRate',
  'channels',
  'fileSize',
  'path',
] as const;
export type MirrorSortColumn = (typeof MIRROR_SORT_COLUMNS)[number];

export function isMirrorSortColumn(value: unknown): value is MirrorSortColumn {
  return MIRROR_SORT_COLUMNS.some((column) => column === value);
}

/** 宿主媒体库曲目行里镜像存的键，含义见 SDK 的 `Track`；`albumId` 只在专辑名或艺术家名不是合法 UTF-8 时有 */
export interface MirrorTrack {
  readonly handle: string;
  readonly path: string;
  readonly absolutePath: string;
  readonly subsong: number;
  readonly title: string;
  readonly artist: string;
  readonly artists: readonly string[];
  readonly album: string;
  readonly albumId?: string;
  readonly albumArtist: string;
  readonly albumArtists: readonly string[];
  readonly genre: string;
  readonly date: string;
  readonly trackNumber: number;
  readonly discNumber: number;
  readonly duration: number;
  readonly fileSize: number;
  readonly bitrate: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly codec: string;
  readonly rating: number;
}

/** 镜像读出的行；`index` 是库序，与宿主 `search` 的 ALL 查询里的行号同义 */
export interface MirrorRow extends MirrorTrack {
  readonly index: number;
}

export interface MirrorStatus {
  readonly schema: number;
  readonly epoch: string;
  readonly revision: number;
  readonly count: number;
  /** 还没有完整的镜像（从没建过，或重建没有收尾）时为假，此时不能读 */
  readonly ready: boolean;
  /** 镜像文件（含预写日志）占的磁盘字节数；内存库为 0，旧后端不报时读作 0 */
  readonly bytes: number;
}

export interface MirrorApplyRequest {
  readonly epoch: string;
  readonly since: number;
  readonly revision: number;
  readonly upsert: readonly MirrorTrack[];
  readonly remove: readonly string[];
}

/** `stale`：镜像的纪元或修订号与请求不符，没有写入，页面要重新对账 */
export type MirrorApplyReply =
  { readonly stale: true } | { readonly stale: false; readonly count: number };

export interface MirrorPageRequest {
  readonly sort: MirrorSortColumn;
  readonly descending: boolean;
  /** 上一页答复里的 `next`；取第一页时为 null */
  readonly after: string | null;
  readonly limit: number;
}

export interface MirrorPage {
  readonly rows: readonly MirrorRow[];
  /** 还有后续时是下一页要带的游标，到头为 null */
  readonly next: string | null;
  readonly total: number;
}

/** 只要次序的翻页：`paths` 为真时再带每首的路径与 subsong（起播与发送要用），句柄之外的整行不带 */
export interface MirrorOrderRequest extends MirrorPageRequest {
  readonly paths: boolean;
}

/** 三个数组按下标对齐；`paths` 为假时 `paths` 与 `subsongs` 为空数组 */
export interface MirrorOrder {
  readonly handles: readonly string[];
  readonly paths: readonly string[];
  readonly subsongs: readonly number[];
  readonly next: string | null;
  readonly total: number;
}

export interface MirrorAlbum {
  readonly albumId?: string;
  readonly name: string;
  readonly artist: string;
  readonly albumArtist: string;
  readonly trackCount: number;
  readonly discCount: number;
  readonly duration: number;
  readonly year: string;
  readonly genre: string;
  readonly firstTrackPath: string;
  readonly firstTrackAbsolutePath: string;
}

export interface MirrorArtistAlbum {
  readonly albumId?: string;
  readonly name: string;
  readonly artist: string;
}

export interface MirrorArtist {
  readonly name: string;
  readonly albumCount: number;
  readonly trackCount: number;
  readonly totalDuration: number;
  readonly albums: readonly MirrorArtistAlbum[];
}

const INVALID = new Error('镜像数据无效');

function field(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : undefined;
}

function need<T>(value: T | null): T {
  if (value === null) throw INVALID;
  return value;
}

const str = (raw: unknown, key: string): string | null => {
  const value = field(raw, key);
  return typeof value === 'string' ? value : null;
};

const num = (raw: unknown, key: string): number | null => {
  const value = field(raw, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const int = (raw: unknown, key: string): number | null => {
  const value = num(raw, key);
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
};

const strings = (raw: unknown, key: string): string[] | null => {
  const value = field(raw, key);
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value.map(String)
    : null;
};

function parse<T>(read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (error === INVALID) return null;
    throw error;
  }
}

/** 校验宿主的曲目行，缺键、类型不对或 `handle` 为空都答 null；多出来的键不要 */
export function readMirrorTrack(raw: unknown): MirrorTrack | null {
  return parse(() => {
    const albumId = field(raw, 'albumId');
    if (albumId !== undefined && typeof albumId !== 'string') return null;
    const track: MirrorTrack = {
      handle: need(str(raw, 'handle')),
      path: need(str(raw, 'path')),
      absolutePath: need(str(raw, 'absolutePath')),
      subsong: need(int(raw, 'subsong')),
      title: need(str(raw, 'title')),
      artist: need(str(raw, 'artist')),
      artists: need(strings(raw, 'artists')),
      album: need(str(raw, 'album')),
      albumArtist: need(str(raw, 'albumArtist')),
      albumArtists: need(strings(raw, 'albumArtists')),
      genre: need(str(raw, 'genre')),
      date: need(str(raw, 'date')),
      trackNumber: need(num(raw, 'trackNumber')),
      discNumber: need(num(raw, 'discNumber')),
      duration: need(num(raw, 'duration')),
      fileSize: need(num(raw, 'fileSize')),
      bitrate: need(num(raw, 'bitrate')),
      sampleRate: need(num(raw, 'sampleRate')),
      channels: need(num(raw, 'channels')),
      codec: need(str(raw, 'codec')),
      rating: need(num(raw, 'rating')),
    };
    if (track.handle === '') return null;
    return albumId === undefined ? track : { ...track, albumId };
  });
}

export function readMirrorRow(raw: unknown): MirrorRow | null {
  const track = readMirrorTrack(raw);
  const index = int(raw, 'index');
  return track && index !== null ? { ...track, index } : null;
}

export function readMirrorStatus(raw: unknown): MirrorStatus | null {
  return parse(() => {
    const ready = field(raw, 'ready');
    if (typeof ready !== 'boolean') return null;
    return {
      schema: need(int(raw, 'schema')),
      epoch: need(str(raw, 'epoch')),
      revision: need(int(raw, 'revision')),
      count: need(int(raw, 'count')),
      ready,
      bytes: int(raw, 'bytes') ?? 0,
    };
  });
}

export function readMirrorApply(raw: unknown): MirrorApplyReply | null {
  const stale = field(raw, 'stale');
  if (stale === true) return { stale: true };
  const count = int(raw, 'count');
  return stale === false && count !== null ? { stale: false, count } : null;
}

export function readMirrorPage(raw: unknown): MirrorPage | null {
  return parse(() => {
    const rows = field(raw, 'rows');
    const next = field(raw, 'next');
    if (!Array.isArray(rows) || (next !== null && typeof next !== 'string')) return null;
    return {
      rows: rows.map((row) => need(readMirrorRow(row))),
      next,
      total: need(int(raw, 'total')),
    };
  });
}

export function readMirrorOrder(raw: unknown, paths: boolean): MirrorOrder | null {
  const handles = strings(raw, 'handles');
  const next = field(raw, 'next');
  const total = int(raw, 'total');
  if (!handles || total === null || (next !== null && typeof next !== 'string')) return null;
  if (!paths) return { handles, paths: [], subsongs: [], next, total };
  const texts = strings(raw, 'paths');
  const subsongs = field(raw, 'subsongs');
  if (
    !texts ||
    !Array.isArray(subsongs) ||
    texts.length !== handles.length ||
    subsongs.length !== handles.length ||
    !subsongs.every((value) => typeof value === 'number' && Number.isSafeInteger(value))
  )
    return null;
  return { handles, paths: texts, subsongs: subsongs.map(Number), next, total };
}

function readAlbumId(raw: unknown): { albumId?: string } | null {
  const albumId = field(raw, 'albumId');
  if (albumId === undefined) return {};
  return typeof albumId === 'string' ? { albumId } : null;
}

export function readMirrorAlbums(raw: unknown): MirrorAlbum[] | null {
  const albums = field(raw, 'albums');
  if (!Array.isArray(albums)) return null;
  return parse(() =>
    albums.map((item): MirrorAlbum => {
      return {
        ...need(readAlbumId(item)),
        name: need(str(item, 'name')),
        artist: need(str(item, 'artist')),
        albumArtist: need(str(item, 'albumArtist')),
        trackCount: need(int(item, 'trackCount')),
        discCount: need(int(item, 'discCount')),
        duration: need(num(item, 'duration')),
        year: need(str(item, 'year')),
        genre: need(str(item, 'genre')),
        firstTrackPath: need(str(item, 'firstTrackPath')),
        firstTrackAbsolutePath: need(str(item, 'firstTrackAbsolutePath')),
      };
    }),
  );
}

export function readMirrorArtists(raw: unknown): MirrorArtist[] | null {
  const artists = field(raw, 'artists');
  if (!Array.isArray(artists)) return null;
  return parse(() =>
    artists.map((item): MirrorArtist => {
      const albums = field(item, 'albums');
      if (!Array.isArray(albums)) throw INVALID;
      return {
        name: need(str(item, 'name')),
        albumCount: need(int(item, 'albumCount')),
        trackCount: need(int(item, 'trackCount')),
        totalDuration: need(num(item, 'totalDuration')),
        albums: albums.map((album) => ({
          ...need(readAlbumId(album)),
          name: need(str(album, 'name')),
          artist: need(str(album, 'artist')),
        })),
      };
    }),
  );
}

/** `rebuildBegin` 答的代次；之后的 `rebuildPut` 与 `rebuildCommit` 要带上 */
export function readMirrorGeneration(raw: unknown): number | null {
  return int(raw, 'generation');
}
