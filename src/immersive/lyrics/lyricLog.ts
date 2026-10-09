import type { LyricsDisplay } from '../../lyrics/lyricsDisplay.ts';
import { atom, type Atom } from 'jotai/vanilla';
import { playbackAtom } from '../../playback/playback.ts';
import type { Store } from '../../kit/store.ts';
import type { LyricsService, LyricsState } from '../../lyrics/lyricsService.ts';

export const LYRIC_STATUS_MESSAGES = {
  loading: 'lyrics.loading',
  searching: 'lyrics.searching',
  'local-failed': 'lyrics.localFailed',
  'online-failed': 'lyrics.onlineFailed',
} as const;

export type LyricLogState = 'none' | 'plain' | 'synced' | keyof typeof LYRIC_STATUS_MESSAGES;

interface LyricLine {
  /** 秒。 */
  readonly time: number;
  readonly end: number;
  readonly text: string;
  readonly translation: string;
}

export interface LyricRows {
  prev: LyricLine | null;
  current: LyricLine | null;
  next: LyricLine | null;
}

/** 歌词卡的两行：主行是当前行；副行有译文放译文，没有放下一句，都没有就空、卡按一行排。 */
export interface LyricCardLines {
  main: string;
  sub: string;
  /** 副行放的是什么：译文与下一句的颜色不同。 */
  subKind: 'translation' | 'next' | 'none';
}

export interface LyricLog {
  readonly state: LyricLogState;
  /** 本地或在线来源；尚未取得歌词时为空串。 */
  readonly source: string;
  /** 无时间轴时的非空行数；有时间轴与无词时为 0。 */
  readonly lineCount: number;
}

export interface LyricLogService {
  dispose(): void;
}

interface Loaded extends LyricLog {
  readonly lines: readonly LyricLine[];
}

const EMPTY: Loaded = { state: 'none', source: '', lineCount: 0, lines: [] };
const NO_ROWS: LyricRows = { prev: null, current: null, next: null };
const loadedAtom = atom<Loaded>(EMPTY);
const positionAtom = atom(0);
const showTranslationAtom = atom(true);

export const lyricLogAtom: Atom<LyricLog> = atom((get) => {
  const { state, source, lineCount } = get(loadedAtom);
  return { state, source, lineCount };
});

/** 首行之前与无时间轴时为 -1；最后一句结束后为行数，使当前行留空。 */
const indexAtom = atom((get) => {
  const { state, lines } = get(loadedAtom);
  if (state !== 'synced') return -1;
  const position = get(positionAtom);
  const at = currentIndex(lines, position);
  const last = lines.at(-1);
  return last && position >= last.end ? lines.length : at;
});

/** 有时间轴时按播放位置取的三行；首行之前当前行为空、下一行是首行。 */
export const lyricRowsAtom: Atom<LyricRows> = atom((get) => {
  const { state, lines } = get(loadedAtom);
  if (state !== 'synced') return NO_ROWS;
  const at = get(indexAtom);
  return {
    prev: lines[at - 1] ?? null,
    current: lines[at] ?? null,
    next: lines[at + 1] ?? null,
  };
});

/** 有时间轴且已播到首行才有；首行之前、无时间轴与无词时为 null，无时间轴那一行由调用方按 `lineCount` 写。 */
export const lyricCardAtom: Atom<LyricCardLines | null> = atom((get) => {
  const { current, next } = get(lyricRowsAtom);
  if (!current) return null;
  if (current.translation && get(showTranslationAtom)) {
    return { main: current.text, sub: current.translation, subKind: 'translation' };
  }
  if (next?.text) return { main: current.text, sub: next.text, subKind: 'next' };
  return { main: current.text, sub: '', subKind: 'none' };
});

function project(result: LyricsState): Loaded {
  if (result.status === 'loading')
    return { ...EMPTY, state: result.stage === 'online' ? 'searching' : 'loading' };
  if (result.status === 'failed')
    return { ...EMPTY, state: result.stage === 'online' ? 'online-failed' : 'local-failed' };
  if (result.status !== 'ready') return EMPTY;
  const { content, source } = result;
  if (content.kind === 'plain')
    return { ...EMPTY, state: 'plain', source, lineCount: content.lines.length };
  // 双行卡和日志只跟随主唱，避免背景人声把当前句顶掉；不改共享的逐字数据。
  const main = content.lines.filter((line) => !line.isBG);
  const sorted = (main.length ? main : content.lines)
    .map((line) => ({
      time: line.startTime / 1000,
      end: line.endTime / 1000,
      text: line.words
        .map((word) => word.word)
        .join('')
        .trim(),
      translation: line.translatedLyric,
    }))
    .sort((a, b) => a.time - b.time);
  // 解析器把间奏空行记在上一句的结束时间，日志将这段空隙还原为独立的一行。
  const lines = sorted.flatMap((line, index) => {
    const next = sorted[index + 1];
    return next && line.end > line.time && line.end < next.time
      ? [line, { time: line.end, end: next.time, text: '', translation: '' }]
      : [line];
  });
  return {
    state: 'synced',
    source,
    lineCount: 0,
    lines,
  };
}

/**
 * 把共用歌词投影为双行卡与三行日志。只在沉浸视图可见时订阅，离开后冻结退场内容；
 * 重新进入先订阅再初读。同一行内只更新位置，行下标不变就不重新发布行内容。
 */
export function startLyricLog(
  store: Store,
  {
    lyrics,
    active,
    offset,
    display,
  }: {
    lyrics: Pick<LyricsService, 'state'>;
    active: Atom<boolean>;
    offset?: Atom<number>;
    display?: Atom<LyricsDisplay>;
  },
): LyricLogService {
  store.set(loadedAtom, EMPTY);
  store.set(positionAtom, 0);
  let offs: (() => void)[] = [];
  const updateLyrics = () => store.set(loadedAtom, project(store.get(lyrics.state)));
  const updatePosition = () =>
    store.set(positionAtom, store.get(playbackAtom).position - (offset ? store.get(offset) : 0));
  const updateDisplay = () =>
    store.set(showTranslationAtom, display ? store.get(display).showTranslation : true);

  function follow(): void {
    for (const off of offs.splice(0)) off();
    if (!store.get(active)) return;
    offs = [
      store.sub(lyrics.state, updateLyrics),
      store.sub(playbackAtom, updatePosition),
      ...(offset ? [store.sub(offset, updatePosition)] : []),
      ...(display ? [store.sub(display, updateDisplay)] : []),
    ];
    updateDisplay();
    updatePosition();
    updateLyrics();
  }

  const stopActive = store.sub(active, follow);
  follow();

  return {
    dispose() {
      stopActive();
      for (const off of offs.splice(0)) off();
    },
  };
}

/** `position`（秒）落在哪一行：时间不晚于它的最后一行；首行之前是 -1。 */
function currentIndex(lines: readonly LyricLine[], position: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((lines[middle]?.time ?? Infinity) <= position) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** 时间码显示成 mm:ss；日志的行宽不放百分秒。 */
export function formatLyricTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${String(minutes).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
