import { settle } from '../host/hostCall.ts';
import type { LyricsTarget } from './lyricsService.ts';
import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/core';
import { atom, type Atom } from 'jotai/vanilla';
import {
  defineConfigPref,
  registerConfigPersistence,
  type ConfigSaveState,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../host/configPref.ts';
import type { ConfigWriter } from '../host/configWrite.ts';
import type { Store } from '../kit/store.ts';
import type { LyricsContent } from './lyricsText.ts';
import {
  LYRICS_SOURCE_IDS,
  type LyricsCandidate,
  type LyricsSourceId,
} from './online/lyricsSource.ts';
import type { MatchResult } from './online/lyricsMatch.ts';

export interface LyricsReady {
  readonly status: 'ready';
  readonly key: string;
  readonly source: 'file' | 'embedded' | LyricsSourceId;
  readonly content: LyricsContent;
  readonly sourcePath?: string;
  readonly candidate?: LyricsCandidate;
  readonly match?: MatchResult;
}

const field = (raw: unknown, key: string): unknown =>
  raw && typeof raw === 'object' ? Reflect.get(raw, key) : undefined;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function word(raw: unknown): LyricWord | null {
  const startTime = field(raw, 'startTime');
  const endTime = field(raw, 'endTime');
  const text = field(raw, 'word');
  if (!finite(startTime) || !finite(endTime) || typeof text !== 'string') return null;
  const romanWord = field(raw, 'romanWord');
  const obscene = field(raw, 'obscene');
  const ruby = field(raw, 'ruby');
  if (
    ruby !== undefined &&
    (!Array.isArray(ruby) || ruby.some((item: unknown) => field(item, 'ruby') !== undefined))
  )
    return null;
  const parsedRuby = Array.isArray(ruby) ? ruby.map((item: unknown) => word(item)) : undefined;
  if (parsedRuby?.some((item) => !item)) return null;
  return {
    startTime,
    endTime,
    word: text,
    ...(typeof romanWord === 'string' ? { romanWord } : {}),
    ...(typeof obscene === 'boolean' ? { obscene } : {}),
    ...(parsedRuby ? { ruby: parsedRuby.filter((item) => item !== null) } : {}),
  };
}

function line(raw: unknown): LyricLine | null {
  const words = field(raw, 'words');
  const startTime = field(raw, 'startTime');
  const endTime = field(raw, 'endTime');
  const translatedLyric = field(raw, 'translatedLyric');
  const romanLyric = field(raw, 'romanLyric');
  const isBG = field(raw, 'isBG');
  const isDuet = field(raw, 'isDuet');
  if (
    !Array.isArray(words) ||
    !finite(startTime) ||
    !finite(endTime) ||
    typeof translatedLyric !== 'string' ||
    typeof romanLyric !== 'string' ||
    typeof isBG !== 'boolean' ||
    typeof isDuet !== 'boolean'
  )
    return null;
  const parsed = words.map((item: unknown) => word(item));
  if (parsed.some((item) => !item)) return null;
  return {
    startTime,
    endTime,
    translatedLyric,
    romanLyric,
    isBG,
    isDuet,
    words: parsed.filter((item) => item !== null),
  };
}

/** 存档保留逐字、译文、音译、注音与人声角色，不经过文本格式转换。 */
export function readSavedLyrics(text: string): LyricsReady | null {
  try {
    const raw: unknown = JSON.parse(text);
    const key = field(raw, 'key');
    const source = ['file', 'embedded', ...LYRICS_SOURCE_IDS].find(
      (id) => id === field(raw, 'source'),
    );
    const body = field(raw, 'content');
    const lines = field(body, 'lines');
    if (typeof key !== 'string' || !source || !Array.isArray(lines)) return null;
    let content: LyricsContent;
    if (field(body, 'kind') === 'plain' && lines.every((item: unknown) => typeof item === 'string'))
      content = {
        kind: 'plain',
        lines: lines.filter((item: unknown): item is string => typeof item === 'string'),
      };
    else if (field(body, 'kind') === 'synced') {
      const parsed = lines.map((item: unknown) => line(item));
      if (parsed.some((item) => !item)) return null;
      content = { kind: 'synced', lines: parsed.filter((item) => item !== null) };
    } else return null;
    const knownSource = LYRICS_SOURCE_IDS.find((id) => id === source);
    const sourcePath = field(raw, 'sourcePath');
    return {
      status: 'ready',
      key,
      source: knownSource ?? (source === 'file' ? 'file' : 'embedded'),
      content,
      ...(typeof sourcePath === 'string' ? { sourcePath } : {}),
    };
  } catch {
    return null;
  }
}

/** 内容本身参与版本身份；来源返回同一编号的新正文不会继承旧校正。 */
export function lyricsVersion(lyrics: LyricsReady): string {
  const { content } = lyrics;
  return JSON.stringify([
    lyrics.source,
    content.kind,
    content.kind === 'plain'
      ? content.lines
      : content.lines.map((line) => [
          line.startTime,
          line.endTime,
          line.isBG,
          line.isDuet,
          line.translatedLyric,
          line.romanLyric,
          line.words.map((word) => [
            word.startTime,
            word.endTime,
            word.word,
            word.romanWord ?? null,
            word.obscene ?? null,
            word.ruby?.map((ruby) => [ruby.startTime, ruby.endTime, ruby.word]) ?? null,
          ]),
        ]),
  ]);
}

const EMPTY = { selected: '', offsets: {} as Record<string, number> };
function parseRecord(raw: unknown) {
  const selected = field(raw, 'selected');
  const saved = field(raw, 'offsets');
  if (
    typeof selected !== 'string' ||
    (selected && !readSavedLyrics(selected)) ||
    !saved ||
    typeof saved !== 'object' ||
    Array.isArray(saved)
  )
    return undefined;
  const offsets: Record<string, number> = {};
  for (const [key, value] of Object.entries(saved))
    if (finite(value) && Math.abs(value) <= 600)
      Object.defineProperty(offsets, key, { value, enumerable: true });
  return { selected, offsets };
}

/** 每首曲目独立存档，晚到的初读和写入不影响其他曲目的选择。 */
export function startLyricsArchive(
  store: Store,
  track: Atom<LyricsTarget | null>,
  host: ConfigPrefFace,
  writer: Pick<ConfigWriter, 'set'>,
) {
  function create(key: string) {
    const pref = defineConfigPref(
      `defaultTheme.lyrics.track.${encodeURIComponent(key)}`,
      EMPTY,
      parseRecord,
    );
    let readable = false;
    const face: ConfigPrefFace = {
      ...host,
      config: {
        ...host.config,
        async get(name) {
          const answer = await settle(() => host.config.get(name));
          if (!answer) throw new Error('歌词存档读取失败');
          readable =
            answer.success !== false && (!answer.found || parseRecord(answer.value) !== undefined);
          return answer;
        },
      },
    };
    const persistence = startConfigPrefs(store, [pref], face, writer);
    const draft = atom<typeof EMPTY | null>(null);
    const value = atom((get) => get(draft) ?? get(pref.atom));
    const changes: ((value: typeof EMPTY) => typeof EMPTY)[] = [];
    const blocked = atom<ReadonlyMap<string, ConfigSaveState>>((get) =>
      get(draft) === null
        ? new Map()
        : new Map([[pref.key, { status: 'failed', reason: 'unavailable' }]]),
    );
    let retrying: Promise<boolean> | null = null;
    async function retryOnce() {
      if (store.get(draft) === null) return persistence.retry(pref.key);
      const answer = await settle(() => host.config.get(pref.key));
      if (disposed || !answer || answer.success === false) return false;
      const saved = answer.found ? parseRecord(answer.value) : EMPTY;
      if (!saved) return false;
      const merged = changes.reduce((value, change) => change(value), saved);
      changes.length = 0;
      readable = true;
      const result = persistence.set(pref, merged);
      store.set(draft, null);
      return result;
    }
    function retry() {
      retrying ??= retryOnce().finally(() => {
        retrying = null;
      });
      return retrying;
    }
    const unregister = registerConfigPersistence(store, { state: blocked, retry });
    return {
      pref,
      persistence,
      value,
      state: atom((get) => new Map([...get(persistence.state), ...get(blocked)])),
      retry,
      async save(change: (value: typeof EMPTY) => typeof EMPTY) {
        await persistence.ready;
        if (disposed) return false;
        if (!readable) {
          changes.push(change);
          store.set(draft, change(store.get(value)));
          return false;
        }
        return persistence.set(pref, change(store.get(value)));
      },
      dispose() {
        unregister();
        persistence.dispose();
      },
    };
  }
  const entries = new Map<string, ReturnType<typeof create>>();
  const all = atom<readonly ReturnType<typeof create>[]>([]);
  const current = atom<ReturnType<typeof create> | null>(null);
  let disposed = false;
  function follow() {
    const target = store.get(track);
    const key = target
      ? target.local
        ? target.key
        : JSON.stringify([target.key, target.query])
      : undefined;
    if (!key) {
      store.set(current, null);
      return;
    }
    let entry = entries.get(key);
    if (!entry) {
      entry = create(key);
      entries.set(key, entry);
      store.set(all, [...entries.values()]);
    }
    store.set(current, entry);
  }
  const off = store.sub(track, follow);
  follow();
  const record = atom((get) => {
    const entry = get(current);
    return entry ? get(entry.value) : EMPTY;
  });
  const persistence: ConfigPersistence = {
    state: atom((get) => new Map(get(all).flatMap((entry) => [...get(entry.state)]))),
    async retry(key) {
      return entries.size > 0
        ? (
            await Promise.all(
              [...entries.values()]
                .filter((entry) => entry.pref.key === key)
                .map((entry) => entry.retry()),
            )
          ).some(Boolean)
        : false;
    },
    async settled() {
      await Promise.all([...entries.values()].map((entry) => entry.persistence.settled()));
    },
  };
  async function update(key: string, change: (value: typeof EMPTY) => typeof EMPTY) {
    const entry = store.get(track)?.key === key ? store.get(current) : null;
    if (disposed || !entry) return false;
    return entry.save(change);
  }
  const selectedText = atom((get) => get(record).selected);
  return {
    record,
    persistence,
    selected: atom((get) => readSavedLyrics(get(selectedText))),
    select(key: string, lyrics: LyricsReady | null) {
      return update(key, (value) => ({ ...value, selected: lyrics ? JSON.stringify(lyrics) : '' }));
    },
    setOffset(key: string, version: string, offset: number) {
      if (!Number.isFinite(offset)) return Promise.resolve(false);
      return update(key, (value) => ({
        ...value,
        offsets: { ...value.offsets, [version]: Math.min(600, Math.max(-600, offset)) },
      }));
    },
    dispose() {
      disposed = true;
      off();
      for (const entry of entries.values()) entry.dispose();
    },
  };
}

export type LyricsArchive = ReturnType<typeof startLyricsArchive>;
