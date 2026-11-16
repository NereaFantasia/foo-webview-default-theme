/** 播放统计分页与写入的行数上限 */
export const LIBRARY_STATS_PAGE = 2000;

export interface LibraryStatsRow {
  readonly handle: string;
  readonly path: string;
  readonly success: true;
  readonly playCount?: number;
  readonly firstPlayed?: string;
  readonly lastPlayed?: string;
  readonly added?: string;
  readonly rating?: number;
}

export interface LibraryStatsStatus {
  readonly ready: boolean;
  readonly epoch: string;
  readonly revision: number;
  readonly generation: number;
}

export interface LibraryStatsPage {
  readonly rows: readonly LibraryStatsRow[];
  readonly next: string | null;
}

type WritableStatsRow = { -readonly [Key in keyof LibraryStatsRow]: LibraryStatsRow[Key] };

function field(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : undefined;
}

function count(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0;
}

export function readLibraryStatsRow(raw: unknown): LibraryStatsRow | null {
  const handle = field(raw, 'handle');
  const path = field(raw, 'path');
  if (
    typeof handle !== 'string' ||
    !handle ||
    typeof path !== 'string' ||
    !path ||
    field(raw, 'success') !== true
  )
    return null;
  const row: WritableStatsRow = { handle, path, success: true };
  for (const key of ['playCount', 'rating'] as const) {
    const value = field(raw, key);
    if (value === undefined) continue;
    if (!count(value) || (key === 'rating' && value > 5)) return null;
    row[key] = value;
  }
  for (const key of ['firstPlayed', 'lastPlayed', 'added'] as const) {
    const value = field(raw, key);
    if (value === undefined) continue;
    if (typeof value !== 'string') return null;
    row[key] = value;
  }
  return row;
}

export function readLibraryStatsStatus(raw: unknown): LibraryStatsStatus | null {
  const ready = field(raw, 'ready');
  const epoch = field(raw, 'epoch');
  const revision = field(raw, 'revision');
  const generation = field(raw, 'generation');
  return typeof ready === 'boolean' &&
    typeof epoch === 'string' &&
    count(revision) &&
    count(generation)
    ? { ready, epoch, revision, generation }
    : null;
}

export function readLibraryStatsPage(raw: unknown): LibraryStatsPage | null {
  const rows = field(raw, 'rows');
  const next = field(raw, 'next');
  if (
    !Array.isArray(rows) ||
    rows.length > LIBRARY_STATS_PAGE ||
    (next !== null && typeof next !== 'string')
  )
    return null;
  const parsed = rows.map(readLibraryStatsRow);
  return parsed.every((row) => row !== null) ? { rows: parsed, next } : null;
}
