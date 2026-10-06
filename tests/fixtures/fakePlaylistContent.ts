import type { ApiFailure, PlaylistGroupRun, PlaylistInfo, PlaylistTrack } from 'foo-webview-sdk';
import type { FakeHost, HostParams } from './fakeHost.ts';
import type { Emit, FakePlaylists } from './fakePlaylists.ts';
import { formatTitle } from './fakeTitleFormat.ts';
import { hostFailure, isRecord, listParam, numberParam, stringParam } from './hostAnswers.ts';
import { makeTrack } from './tracks.ts';

/** 一张列表里的一行，列表按 GUID 认。 */
export interface RowRef {
  readonly guid: string;
  readonly row: number;
}

/** 改写后的一行从哪来：原来的第几行，或新插进来的曲目。 */
type Origin = number | PlaylistTrack;

const byNumber = (a: number, b: number) => a - b;

/** 行号参数：全是非负整数才收，否则为 null，宿主这时答 INVALID_PARAMS。 */
function rowsParam(params: HostParams, key: string): number[] | null {
  const list = listParam(params, key);
  const rows = list.filter(
    (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0,
  );
  return rows.length === list.length ? rows : null;
}

/** 宿主只按 ASCII 字母不分大小写比组键。 */
const foldKey = (key: string) => key.replace(/[A-Z]/g, (char) => char.toLowerCase());

/** 相邻、组键相同的行并成一段；`offset` 是 `rows` 第一行在整张列表里的行号。 */
function runsOf(rows: readonly PlaylistTrack[], pattern: string, offset: number) {
  const runs: { start: number; count: number; key: string }[] = [];
  rows.forEach((track, at) => {
    const key = formatTitle(pattern, track);
    const last = runs.at(-1);
    if (last && foldKey(last.key) === foldKey(key)) last.count += 1;
    else runs.push({ start: offset + at, count: 1, key });
  });
  return runs;
}

/** 选中的行各往 `delta` 的方向挪一格，挪 |delta| 轮；碰到头或前面是挪不动的选中行就停。答新的行序。 */
function moveSelected(count: number, selected: ReadonlySet<number>, delta: number): number[] {
  const order = Array.from({ length: count }, (_, row) => row);
  const step = Math.sign(delta);
  for (let round = 0; round < Math.abs(delta); round += 1) {
    let moved = false;
    const rows = Array.from({ length: count }, (_, at) => (step > 0 ? count - 1 - at : at));
    for (const at of rows) {
      const next = at + step;
      const here = order[at];
      const there = order[next];
      if (here === undefined || there === undefined) continue;
      if (!selected.has(here) || selected.has(there)) continue;
      order[at] = there;
      order[next] = here;
      moved = true;
    }
    if (!moved) break;
  }
  return order;
}

/** `insertTracks` 的一项：`路径|subsong:N` 或 `{ path, subsong }`；认不得的为 null。 */
function handleOf(entry: unknown): { path: string; subsong: number } | null {
  if (typeof entry === 'string' && entry !== '') {
    const [path = '', subsong] = entry.split('|subsong:');
    return { path, subsong: Number(subsong ?? 0) || 0 };
  }
  if (isRecord(entry) && typeof entry['path'] === 'string' && entry['path'] !== '') {
    const subsong = entry['subsong'];
    return { path: entry['path'], subsong: typeof subsong === 'number' ? subsong : 0 };
  }
  return null;
}

/**
 * 列表内容一侧的宿主替身，挂在 `FakePlaylists` 上：宿主选中、增删行、挪动与排序、撤销与重做、分组游程、
 * 锁、正在播放的位置与按列表坐标入队。像宿主那样在应答之前推事件；写锁定的列表答 LOCKED，列表不在答
 * NOT_FOUND。每次改内容都先存一个撤销点，选中与正在播放的那一行跟着行走。
 *
 * 几处是近似：打乱是确定的（先偶数行、再奇数行），测试好断言；撤销与重做按行数增减推 itemsAdded、
 * itemsRemoved 或 itemsReordered，不细分改在哪几行；分组游程按替身的 Title Formatting 现算，
 * 也可以用 `setRuns` 指定。
 */
export class FakePlaylistContent {
  /** 正在播放的那一行：`playTrack` 记下，行增删、挪动时跟着走，被删掉时 `row` 为 -1。 */
  playing: RowRef | null = null;
  /** `queue.add` 收下的行，按收到的先后。 */
  readonly queued: RowRef[] = [];
  private playingHandle = '';
  private readonly selections = new Map<string, ReadonlySet<number>>();
  private readonly undos = new Map<string, PlaylistTrack[][]>();
  private readonly redos = new Map<string, PlaylistTrack[][]>();
  private readonly fixedRuns = new Map<string, PlaylistGroupRun[]>();

  constructor(
    host: FakeHost,
    private readonly lists: FakePlaylists,
    private readonly emit: Emit,
  ) {
    host.answerAll({
      playlist: {
        getSelection: (params) =>
          this.read(params, (list) => {
            const items = this.selection(list.guid);
            return {
              success: true,
              items,
              count: items.length,
              playlist: list.index,
              playlistGuid: list.guid,
            };
          }),
        getSelectedTracks: (params) =>
          this.read(params, (list) => {
            const selected = this.selectedSet(list.guid);
            const tracks = this.lists.tracksOf(list).filter((_, row) => selected.has(row));
            return {
              success: true,
              playlist: list.index,
              playlistGuid: list.guid,
              tracks,
              count: tracks.length,
            };
          }),
        setSelection: (params) =>
          this.read(params, (list) => {
            const rows = rowsParam(params, 'indices');
            if (!rows) return hostFailure('INVALID_PARAMS');
            const keep = params['clearOthers'] === false ? this.selection(list.guid) : [];
            this.select(list, [...keep, ...rows]);
            return { success: true };
          }),
        selectAll: (params) =>
          this.read(params, (list) => {
            this.select(list, this.lists.tracksOf(list).keys());
            return { success: true };
          }),
        deselectAll: (params) =>
          this.read(params, (list) => {
            this.select(list, []);
            return { success: true };
          }),
        removeSelectedTracks: (params) =>
          this.write(params, (list) => this.removeRows(list, this.selectedSet(list.guid))),
        removeTracks: (params) =>
          this.write(params, (list) => {
            const rows = rowsParam(params, 'items');
            return rows ? this.removeRows(list, new Set(rows)) : hostFailure('INVALID_PARAMS');
          }),
        insertTracks: (params) => this.write(params, (list) => this.insert(list, params)),
        moveTracks: (params) =>
          this.write(params, (list) => {
            const delta = numberParam(params, 'delta');
            const items = rowsParam(params, 'items');
            if (delta === undefined || !Number.isInteger(delta) || !items) {
              return hostFailure('INVALID_PARAMS');
            }
            if (items.length > 0) this.select(list, items);
            const count = this.lists.tracksOf(list).length;
            this.reorder(list, moveSelected(count, this.selectedSet(list.guid), delta));
            return { success: true };
          }),
        sort: (params) => this.write(params, (list) => this.sort(list, params)),
        shuffle: (params) =>
          this.write(params, (list) => {
            const rows = [...this.lists.tracksOf(list).keys()];
            this.reorder(list, [
              ...rows.filter((row) => row % 2 === 0),
              ...rows.filter((row) => row % 2 === 1),
            ]);
            return { success: true };
          }),
        reverse: (params) =>
          this.write(params, (list) => {
            this.reorder(list, [...this.lists.tracksOf(list).keys()].reverse());
            return { success: true };
          }),
        undo: (params) => this.write(params, (list) => this.step(list, this.undos, this.redos)),
        redo: (params) => this.write(params, (list) => this.step(list, this.redos, this.undos)),
        getGroupRuns: (params) =>
          this.read(params, (list) => {
            const patterns = listParam(params, 'patterns');
            const valid = patterns.every(
              (pattern) => typeof pattern === 'string' && pattern !== '',
            );
            if (patterns.length < 1 || patterns.length > 2 || !valid) {
              return hostFailure('INVALID_PARAMS');
            }
            const tracks = this.lists.tracksOf(list);
            const runs =
              this.fixedRuns.get(list.guid) ?? this.runsFor(tracks, patterns.map(String));
            return {
              success: true,
              playlist: list.index,
              playlistGuid: list.guid,
              total: tracks.length,
              runs,
            };
          }),
        getLockInfo: (params) =>
          this.read(params, (list) => ({
            success: true,
            playlist: list.index,
            playlistGuid: list.guid,
            isLocked: list.isLocked,
          })),
      },
      playback: {
        getCurrentTrackIndex: (params) => {
          const at = this.playing;
          const list = at ? this.lists.items.find((item) => item.guid === at.guid) : undefined;
          const track = list && at ? this.lists.tracksOf(list)[at.row] : undefined;
          if (!list || !at || !track) {
            return { success: true, found: false, playlist: null, playlistGuid: null, index: null };
          }
          const found = {
            success: true,
            found: true,
            playlist: list.index,
            playlistGuid: list.guid,
            index: at.row,
          } as const;
          return params['includeTrackInfo'] === true ? { ...found, track } : found;
        },
      },
      queue: {
        add: (params) =>
          this.read(params, (list) => {
            const listed = listParam(params, 'tracks');
            const single = numberParam(params, 'track');
            const asked =
              listed.length > 0
                ? rowsParam(params, 'tracks')
                : single === undefined
                  ? []
                  : [single];
            if (!asked || asked.some((row) => !Number.isInteger(row) || row < 0)) {
              return hostFailure('INVALID_PARAMS');
            }
            const count = this.lists.tracksOf(list).length;
            const rows = asked.filter((row) => row < count);
            if (rows.length === 0) return hostFailure('INVALID_INDEX');
            this.queued.push(...rows.map((row) => ({ guid: list.guid, row })));
            const queueCount = this.queued.length;
            this.emit('playback:queueChanged', { origin: 'user_added', count: queueCount });
            return { success: true, addedCount: rows.length, queueCount };
          }),
      },
    });
  }

  /** 这张列表此刻的宿主选中，行号从小到大。 */
  selection(guid: string): number[] {
    return [...this.selectedSet(guid)].sort(byNumber);
  }

  /** 指定一张列表的分组游程，盖过按 Title Formatting 现算的；给 null 撤掉。 */
  setRuns(guid: string, runs: readonly PlaylistGroupRun[] | null): void {
    if (runs) this.fixedRuns.set(guid, [...runs]);
    else this.fixedRuns.delete(guid);
  }

  /** 宿主开始播这一行（`playTrack` 调它）。 */
  played(list: PlaylistInfo, row: number): void {
    this.playing = { guid: list.guid, row };
    this.playingHandle = this.lists.tracksOf(list)[row]?.handle ?? '';
  }

  /** 按 `playlistGuid`、`playlist` 序号认列表，两样都没给就是活动列表。 */
  private resolve(params: HostParams): PlaylistInfo | undefined {
    if (stringParam(params, 'playlistGuid') || numberParam(params, 'playlist') !== undefined) {
      return this.lists.find(params);
    }
    return this.lists.items.find((item) => item.isActive);
  }

  private read<R>(params: HostParams, answer: (list: PlaylistInfo) => R): R | ApiFailure {
    const list = this.resolve(params);
    return list ? answer(list) : hostFailure('NOT_FOUND');
  }

  private write<R>(params: HostParams, answer: (list: PlaylistInfo) => R): R | ApiFailure {
    const list = this.resolve(params);
    if (!list) return hostFailure('NOT_FOUND');
    return list.isLocked ? hostFailure('LOCKED') : answer(list);
  }

  private selectedSet(guid: string): ReadonlySet<number> {
    return this.selections.get(guid) ?? new Set();
  }

  /** 换掉宿主选中；越界的行不收，真变了才推 selectionChanged。 */
  private select(list: PlaylistInfo, rows: Iterable<number>): void {
    const count = this.lists.tracksOf(list).length;
    const next = new Set([...rows].filter((row) => row < count));
    const current = this.selectedSet(list.guid);
    if (next.size === current.size && [...next].every((row) => current.has(row))) return;
    this.selections.set(list.guid, next);
    this.emit('playlist:selectionChanged', { playlist: list.index, playlistGuid: list.guid });
  }

  private removeRows(list: PlaylistInfo, rows: ReadonlySet<number>) {
    const oldCount = this.lists.tracksOf(list).length;
    const kept = [...Array(oldCount).keys()].filter((row) => !rows.has(row));
    if (kept.length === oldCount) return { success: true } as const;
    this.rewrite(list, kept);
    this.emit('playlist:itemsRemoved', {
      playlist: list.index,
      playlistGuid: list.guid,
      oldCount,
      newCount: kept.length,
    });
    return { success: true } as const;
  }

  private insert(list: PlaylistInfo, params: HostParams) {
    const entries = listParam(params, 'handles');
    const countBefore = this.lists.tracksOf(list).length;
    const at = Math.min(numberParam(params, 'position') ?? countBefore, countBefore);
    const added = entries.flatMap((entry, serial): PlaylistTrack[] => {
      const handle = handleOf(entry);
      if (!handle) return [];
      const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(handle.path);
      const path = scheme ? handle.path : `file://${handle.path}`;
      const track = makeTrack({ path, subsong: handle.subsong, title: `Inserted ${serial + 1}` });
      return [{ ...track, index: 0, composer: '', comment: '' }];
    });
    if (added.length === 0) return hostFailure('NOT_FOUND');
    const rows = [...Array(countBefore).keys()];
    const origins: Origin[] = [...rows.slice(0, at), ...added, ...rows.slice(at)];
    this.rewrite(list, origins);
    this.emit('playlist:itemsAdded', {
      playlist: list.index,
      playlistGuid: list.guid,
      start: at,
      count: added.length,
    });
    return {
      success: true,
      playlist: list.index,
      playlistGuid: list.guid,
      insertIndex: at,
      requestedCount: entries.length,
      addedCount: added.length,
      invalidCount: entries.length - added.length,
      countBefore,
      totalCount: countBefore + added.length,
    } as const;
  }

  /** 照宿主：先按串排（`selectedOnly` 时只在选中的几个位置之间排），`descending` 再把整张倒过来。 */
  private sort(list: PlaylistInfo, params: HostParams) {
    const tracks = this.lists.tracksOf(list);
    const pattern = stringParam(params, 'pattern');
    const keys = tracks.map((track) =>
      pattern === '' ? '' : foldKey(formatTitle(pattern, track)),
    );
    const selected = this.selectedSet(list.guid);
    const slots = [...tracks.keys()].filter(
      (row) => params['selectedOnly'] !== true || selected.has(row),
    );
    const keyOf = (row: number) => keys[row] ?? '';
    const sorted = [...slots].sort((a, b) =>
      keyOf(a) === keyOf(b) ? a - b : keyOf(a) < keyOf(b) ? -1 : 1,
    );
    const order = [...tracks.keys()];
    slots.forEach((slot, at) => {
      order[slot] = sorted[at] ?? slot;
    });
    this.reorder(list, params['descending'] === true ? order.reverse() : order);
    return { success: true } as const;
  }

  private reorder(list: PlaylistInfo, order: readonly number[]): void {
    this.rewrite(list, order);
    this.emit('playlist:itemsReordered', {
      playlist: list.index,
      playlistGuid: list.guid,
      count: order.length,
    });
  }

  /** 按新行序改写一张列表：先存撤销点、清掉重做，选中与正在播放的那一行跟着行走。 */
  private rewrite(list: PlaylistInfo, next: readonly Origin[]): void {
    const old = this.lists.tracksOf(list);
    this.undos.set(list.guid, [...(this.undos.get(list.guid) ?? []), old]);
    this.redos.delete(list.guid);
    const rows = next.flatMap((origin) =>
      typeof origin === 'number' ? (old[origin] ?? []) : [origin],
    );
    this.lists.setTracks(list.guid, rows);
    const selected = this.selectedSet(list.guid);
    const kept = next.flatMap((origin, row) =>
      typeof origin === 'number' && selected.has(origin) ? [row] : [],
    );
    this.selections.set(list.guid, new Set(kept));
    const playing = this.playing;
    if (playing?.guid === list.guid) {
      this.playing = { guid: list.guid, row: next.findIndex((origin) => origin === playing.row) };
    }
  }

  /** 撤销或重做一步：从 `from` 取回一版行，此刻的这一版压进 `to`；选中清空。 */
  private step(
    list: PlaylistInfo,
    from: Map<string, PlaylistTrack[][]>,
    to: Map<string, PlaylistTrack[][]>,
  ) {
    const saved = from.get(list.guid) ?? [];
    const rows = saved.pop();
    if (!rows) return hostFailure('NOT_FOUND');
    const current = this.lists.tracksOf(list);
    to.set(list.guid, [...(to.get(list.guid) ?? []), current]);
    this.lists.setTracks(list.guid, rows);
    this.selections.set(list.guid, new Set());
    if (this.playing?.guid === list.guid) {
      const row = rows.findIndex((track) => track.handle === this.playingHandle);
      this.playing = { guid: list.guid, row };
    }
    const playlist = list.index;
    const [oldCount, newCount] = [current.length, rows.length];
    if (newCount < oldCount)
      this.emit('playlist:itemsRemoved', { playlist, playlistGuid: list.guid, oldCount, newCount });
    else if (newCount > oldCount) {
      this.emit('playlist:itemsAdded', {
        playlist,
        playlistGuid: list.guid,
        start: oldCount,
        count: newCount - oldCount,
      });
    } else
      this.emit('playlist:itemsReordered', { playlist, playlistGuid: list.guid, count: newCount });
    return { success: true } as const;
  }

  private runsFor(
    tracks: readonly PlaylistTrack[],
    patterns: readonly string[],
  ): PlaylistGroupRun[] {
    const [first = '', second] = patterns;
    return runsOf(tracks, first, 0).map((run) =>
      second === undefined
        ? run
        : {
            ...run,
            sub: runsOf(tracks.slice(run.start, run.start + run.count), second, run.start),
          },
    );
  }
}
