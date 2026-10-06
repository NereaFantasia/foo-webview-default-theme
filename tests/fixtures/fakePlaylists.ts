import type { PlaylistInfo, PlaylistTrack, PlaylistTrackPartial } from 'foo-webview-sdk';
import type { FakeHost, HostEvent, HostEventPayload, HostParams } from './fakeHost.ts';
import { FakePlaylistContent } from './fakePlaylistContent.ts';
import { hostFailure, listParam, numberParam, stringParam } from './hostAnswers.ts';
import { makeTrack } from './tracks.ts';

/** `getTracks` 的 `fields` 认的键，与宿主的白名单一致（大小写敏感）。 */
const TRACK_FIELDS: ReadonlySet<string> = new Set([
  'index',
  'handle',
  'title',
  'artist',
  'artists',
  'album',
  'albumArtist',
  'albumArtists',
  'genre',
  'date',
  'trackNumber',
  'discNumber',
  'duration',
  'path',
  'absolutePath',
  'fileSize',
  'bitrate',
  'sampleRate',
  'channels',
  'codec',
  'subsong',
  'rating',
]);

/** 列表里的第 `row` 行：按列表名造路径与标题，测试里好认，例如 `Chill 3`。 */
export function makeRow(
  list: string,
  row: number,
  overrides: Partial<PlaylistTrack> = {},
): PlaylistTrack {
  const track = makeTrack({
    path: `file://E:/Music/${list}/${String(row + 1).padStart(3, '0')}.flac`,
    title: `${list} ${row + 1}`,
    trackNumber: row + 1,
    ...overrides,
  });
  return { ...track, index: row, composer: '', comment: '', ...overrides };
}

/** 按 `fields` 投影一行：只留要的键，宿主总会带上 `index`。 */
function project(track: PlaylistTrack, fields: readonly string[]): PlaylistTrackPartial {
  const row: PlaylistTrackPartial = { ...track };
  for (const key of Object.keys(row)) {
    if (key !== 'index' && !fields.includes(key)) Reflect.deleteProperty(row, key);
  }
  return row;
}

/**
 * `formats` 的几列：替身只认 `%comment%` 与 `%filename%` 两个整串，别的答空串（宿主会真去求值）。
 */
function formatsOf(track: PlaylistTrack, formats: Readonly<Record<string, unknown>>) {
  const name = track.path.slice(track.path.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
  const known: Readonly<Record<string, string>> = {
    '%comment%': track.comment,
    '%filename%': name,
  };
  return Object.fromEntries(
    Object.entries(formats).map(([key, pattern]) => [
      key,
      typeof pattern === 'string' ? (known[pattern] ?? '') : '',
    ]),
  );
}

/** 按序号造一个宿主格式的 GUID，测试里好认：第 3 张是 `{00000000-0000-0000-0000-000000000003}`。 */
export function guidOf(serial: number): string {
  return `{00000000-0000-0000-0000-${String(serial).padStart(12, '0')}}`;
}

/** 一张按 SDK 的 `PlaylistInfo` 填全字段的列表；GUID 缺省按序号造，测试只覆写关心的几项。 */
export function makePlaylist(
  index: number,
  name: string,
  overrides: Partial<PlaylistInfo> = {},
): PlaylistInfo {
  return {
    index,
    guid: guidOf(index),
    name,
    trackCount: 10,
    isActive: false,
    isPlaying: false,
    isLocked: false,
    isAutoplaylist: false,
    ...overrides,
  };
}

/** 往服务那边推一条宿主事件。单测里同步推完，e2e 里经页面异步推。 */
export type Emit = <K extends HostEvent>(event: K, payload: HostEventPayload<K>) => unknown;

/**
 * 一台记账的播放列表宿主：`getAll` 答此刻的清单；激活、新建、改名、删除、复制、重排、清空与转成普通
 * 列表改动清单，并像宿主那样在应答之前推出对应的 playlist 事件。按列表的命令认 `playlistGuid`，没给再认
 * `playlist` 序号；认不到答 NOT_FOUND。删除照宿主（插件 `Fb2kPlaylistService::remove_playlist`）不切换：删掉
 * 活动列表后一张都不活动。复制照宿主放在源列表紧后，是没有锁的普通列表，建好后跟一条 itemsAdded。
 *
 * `getAll` 照宿主的清单缓存答（插件 `Fb2kPlaylistService::get_all_playlists`）：只有列表的改动才让缓存
 * 失效，测试直接给 `items` 赋值也算一次改动；`playTrack` 换了正在播放的列表不失效，读到的 isPlaying
 * 还是旧的。`getPlaying` 不走缓存。`playTrack` 在应答之前推一条 playback:trackChanged。
 *
 * `getTracks` 答一页行（`setTracks` 记的，没记的按曲目数现造），`fields` 照宿主的白名单投影、认不得的键答
 * INVALID_PARAMS，`formats` 见 `formatsOf`；列表不存在时照宿主（插件 `PlaylistApi.cpp` 的 `PlaylistGetTracks`）答空页。
 *
 * 列表内容一侧（选中、增删行、排序、撤销、分组游程、正在播放的位置、入队）在 `content` 里。
 */
export class FakePlaylists {
  /** 列表内容一侧的应答与记账。 */
  readonly content: FakePlaylistContent;
  private list: PlaylistInfo[] = [];
  private cache: PlaylistInfo[] | null = null;
  private serial: number;
  /** 按 GUID 记的行；没记的列表按清单里的曲目数现造（`makeRow`）。 */
  private readonly rows = new Map<string, PlaylistTrack[]>();

  constructor(
    host: FakeHost,
    initial: readonly PlaylistInfo[],
    private readonly emit: Emit,
  ) {
    this.items = initial.map((item, index) => ({ ...item, index }));
    this.serial = 100;
    this.content = new FakePlaylistContent(host, this, emit);
    host.answerAll({
      playlist: {
        getAll: () => {
          this.cache ??= this.snapshot();
          return {
            success: true,
            playlists: this.cache.map((item) => ({ ...item })),
            count: this.cache.length,
          };
        },
        getActive: () => {
          const active = this.items.find((item) => item.isActive);
          if (!active) return { success: true, found: false };
          const { index, guid, name, trackCount, isPlaying, isLocked } = active;
          const duration = this.tracksOf(active).reduce((sum, row) => sum + (row.duration ?? 0), 0);
          return {
            success: true,
            found: true,
            index,
            guid,
            name,
            trackCount,
            duration,
            isActive: true,
            isPlaying,
            isLocked,
          };
        },
        getPlaying: () => {
          const playing = this.items.find((item) => item.isPlaying);
          if (!playing) return { success: true, found: false };
          const { index, guid, name, trackCount, isActive } = playing;
          return { success: true, found: true, index, guid, name, trackCount, isActive };
        },
        getTracks: (params) => {
          const start = numberParam(params, 'start') ?? 0;
          const count = numberParam(params, 'count') ?? 100;
          const listed = listParam(params, 'fields');
          const fields = listed.filter((key) => typeof key === 'string');
          if (fields.length !== listed.length) return hostFailure('INVALID_PARAMS');
          const unknownFields = fields.filter((key) => !TRACK_FIELDS.has(key));
          if (unknownFields.length > 0) {
            return { ...hostFailure('INVALID_PARAMS'), details: { unknownFields } };
          }
          const target = this.find(params);
          // 照宿主：列表不存在答空页，按序号问的回显那个序号，按 GUID 问的答 -1。
          if (!target) {
            const playlist = numberParam(params, 'playlist') ?? -1;
            return { success: true, playlist, start, count: 0, total: 0, tracks: [] };
          }
          const all = this.tracksOf(target);
          const asked = params['formats'];
          const formats = typeof asked === 'object' && asked !== null ? { ...asked } : null;
          const tracks = all.slice(start, start + count).map((track) => {
            const row = fields.length > 0 ? project(track, fields) : { ...track };
            return formats ? { ...row, formats: formatsOf(track, formats) } : row;
          });
          const { index } = target;
          return {
            success: true,
            playlist: index,
            start,
            count: tracks.length,
            total: all.length,
            tracks,
          };
        },
        playTrack: (params) => {
          const target = this.find(params);
          if (!target) return hostFailure('NOT_FOUND');
          this.list = this.list.map((item) => ({ ...item, isPlaying: item === target }));
          this.content.played(target, numberParam(params, 'index') ?? 0);
          this.emit('playback:trackChanged', makeTrack());
          return { success: true };
        },
        setActive: (params) => {
          const target = this.find(params);
          if (!target) return hostFailure('NOT_FOUND');
          this.activate(target.index);
          return { success: true };
        },
        create: (params) => {
          const index = this.items.length;
          const name = stringParam(params, 'name');
          const guid = guidOf((this.serial += 1));
          this.items = [...this.items, makePlaylist(index, name, { guid, trackCount: 0 })];
          this.emit('playlist:created', { index, guid, name });
          return { success: true, index, guid };
        },
        rename: (params) => {
          const target = this.find(params);
          const name = stringParam(params, 'name');
          if (!target) return hostFailure('NOT_FOUND');
          this.items = this.items.map((item) => (item === target ? { ...item, name } : item));
          this.emit('playlist:renamed', { index: target.index, guid: target.guid, name });
          return { success: true };
        },
        remove: (params) => {
          const target = this.find(params);
          if (!target) return hostFailure('NOT_FOUND');
          const oldCount = this.items.length;
          this.reindex(this.items.filter((item) => item !== target));
          this.emit('playlist:removed', {
            oldCount,
            newCount: this.items.length,
            indices: [target.index],
            guids: [target.guid],
          });
          return { success: true };
        },
        duplicate: (params) => {
          const source = this.find(params);
          if (!source) return hostFailure('NOT_FOUND');
          const index = source.index + 1;
          const name = `${source.name} (Copy)`;
          const guid = guidOf((this.serial += 1));
          const copy: PlaylistInfo = {
            ...source,
            guid,
            name,
            isActive: false,
            isPlaying: false,
            isLocked: false,
            isAutoplaylist: false,
          };
          this.reindex([...this.items.slice(0, index), copy, ...this.items.slice(index)]);
          this.emit('playlist:created', { index, guid, name });
          const { trackCount } = source;
          if (trackCount > 0) {
            this.emit('playlist:itemsAdded', {
              playlist: index,
              playlistGuid: guid,
              start: 0,
              count: trackCount,
            });
          }
          return {
            success: true,
            index,
            guid,
            sourcePlaylist: source.index,
            sourcePlaylistGuid: source.guid,
            newPlaylist: index,
            name,
            trackCount,
          };
        },
        reorderPlaylists: (params) => {
          const order = listParam(params, 'newOrder');
          const moved = order.map((at) => (typeof at === 'number' ? this.items[at] : undefined));
          if (moved.length !== this.items.length || moved.some((item) => !item)) {
            return hostFailure('INVALID_PARAMS');
          }
          this.reindex(moved.filter((item) => item !== undefined));
          this.emit('playlist:reordered', {
            count: this.items.length,
            guids: this.items.map((item) => item.guid),
          });
          return { success: true, count: this.items.length };
        },
        removeAutoplaylist: (params) => {
          const target = this.find(params);
          if (!target?.isAutoplaylist) return hostFailure('NOT_FOUND');
          const { index } = target;
          this.items = this.items.map((item) =>
            item === target ? { ...item, isAutoplaylist: false, isLocked: false } : item,
          );
          this.emit('playlist:lockChanged', {
            playlist: index,
            playlistGuid: target.guid,
            locked: false,
          });
          return { success: true, playlist: index, playlistGuid: target.guid, source: 'sdk' };
        },
        clear: (params) => {
          const target = this.find(params);
          if (!target) return hostFailure('NOT_FOUND');
          const { index, trackCount } = target;
          this.rows.delete(target.guid);
          this.items = this.items.map((item) =>
            item === target ? { ...item, trackCount: 0 } : item,
          );
          this.emit('playlist:itemsRemoved', {
            playlist: index,
            playlistGuid: target.guid,
            oldCount: trackCount,
            newCount: 0,
          });
          return {
            success: true,
            playlist: index,
            playlistGuid: target.guid,
            clearedCount: trackCount,
            remainingCount: 0,
          };
        },
      },
    });
  }

  /** 此刻的清单。赋值算一次列表改动，宿主的清单缓存随之失效。 */
  get items(): PlaylistInfo[] {
    return this.list;
  }

  set items(items: PlaylistInfo[]) {
    this.list = items;
    this.cache = null;
  }

  activeGuid(): string | null {
    return this.items.find((item) => item.isActive)?.guid ?? null;
  }

  names(): string[] {
    return this.items.map((item) => item.name);
  }

  /** 按名字找 GUID，测试里点名用。 */
  guid(name: string): string {
    const found = this.items.find((item) => item.name === name);
    if (!found) throw new Error(`清单里没有「${name}」`);
    return found.guid;
  }

  /**
   * 换掉一张列表的行，清单里的曲目数跟着改（算一次列表改动）。不推事件：测试自己推要测的那一条，
   * 行号按数组下标重编。
   */
  setTracks(guid: string, tracks: readonly PlaylistTrack[]): void {
    this.rows.set(
      guid,
      tracks.map((track, index) => ({ ...track, index })),
    );
    this.items = this.items.map((item) =>
      item.guid === guid ? { ...item, trackCount: tracks.length } : item,
    );
  }

  /** 一张列表此刻的行：记过的照记的，没记的按曲目数现造。 */
  tracksOf(list: PlaylistInfo): PlaylistTrack[] {
    return (
      this.rows.get(list.guid) ??
      Array.from({ length: list.trackCount }, (_, row) => makeRow(list.name, row))
    );
  }

  /** 按 playlistGuid 认列表，没给再按 playlist 序号认；认不到为 undefined。 */
  find(params: HostParams): PlaylistInfo | undefined {
    const guid = stringParam(params, 'playlistGuid');
    if (guid) return this.items.find((item) => item.guid === guid);
    return this.items[numberParam(params, 'playlist') ?? -1];
  }

  private activate(index: number): void {
    const old = this.items.find((item) => item.isActive)?.index ?? -1;
    this.items = this.items.map((item) => ({ ...item, isActive: item.index === index }));
    this.emit('playlist:activated', {
      oldIndex: old,
      newIndex: index,
      newGuid: this.items[index]?.guid ?? '',
    });
  }

  private snapshot(): PlaylistInfo[] {
    return this.items.map((item) => ({ ...item }));
  }

  private reindex(items: readonly PlaylistInfo[]): void {
    this.items = items.map((item, index) => ({ ...item, index }));
  }
}
