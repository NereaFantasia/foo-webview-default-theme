import type { Track } from 'foo-webview-sdk';
import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../../kit/store.ts';
import { currentTrackAtom, playbackAtom } from '../../../playback/playback.ts';
import { trackKeyOf, type PlaybackState } from '../../../playback/playbackContract.ts';

/**
 * 换曲的过渡要知道的事：这一次换的是什么、往哪翻、封面要不要换。播放栏三种形态读同一份记录，各自按它放
 * 文字与封面的过渡（`useTextSwap`、`NowPlayingCover`）；记录只在换曲、停止、起播与电台报了新曲名时变，
 * 每 100 ms 一次的进度更新叫不醒读它的组件。
 */

/** 换曲：换了一首；起播：从没有曲目到有；停止：从有到没有；电台：同一路流报了新曲名。 */
export type SwapKind = 'track' | 'enter' | 'leave' | 'refresh';
/** 下一首往左翻、上一首往右翻；认不出来是 `none`。 */
export type SwapDirection = 'next' | 'previous' | 'none';

export interface TrackSwap {
  /** 每换一次加一；0 是这一页还没换过。 */
  readonly serial: number;
  readonly kind: SwapKind;
  readonly direction: SwapDirection;
  /** 前后两首是同一张专辑：封面不做过渡，新图到了直接换。 */
  readonly sameCover: boolean;
  /** 换的那一刻，`performance.now()` 口径，毫秒。 */
  readonly at: number;
}

/** 按了上一首或下一首键之后这么久内换的曲，按键的方向算，毫秒。 */
export const SKIP_INTENT_MS = 2000;
/** 上一首播到离结尾这么近才换曲，算自然接下一首，秒。 */
export const NATURAL_END_S = 2;

/** 按键留下的方向：连按几下同一个方向，`pending` 就是几，每换一首用掉一下。 */
export interface SkipIntent {
  readonly direction: 'next' | 'previous';
  readonly at: number;
  readonly pending: number;
}

const INITIAL: TrackSwap = { serial: 0, kind: 'track', direction: 'none', sameCover: false, at: 0 };
const swapAtom = atom<TrackSwap>(INITIAL);
const intentAtom = atom<SkipIntent | null>(null);

export const trackSwapAtom: Atom<TrackSwap> = atom((get) => get(swapAtom));

/** 播放栏的上一首、下一首键按下时记一下方向，随后到的换曲按它翻。 */
export function noteSkip(
  store: Store,
  direction: SkipIntent['direction'],
  now: number = performance.now(),
): void {
  const last = store.get(intentAtom);
  const pending = last && last.direction === direction && fresh(last, now) ? last.pending + 1 : 1;
  store.set(intentAtom, { direction, at: now, pending });
}

function fresh(intent: SkipIntent, now: number): boolean {
  return intent.pending > 0 && now - intent.at <= SKIP_INTENT_MS;
}

/** 流媒体没有文件：电台换曲时只有曲名变，路径不变。 */
function isStream(track: Pick<Track, 'path'>): boolean {
  return !/^file(?:-relative)?:\/\//i.test(track.path);
}

function folderOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/**
 * 两首是不是同一张专辑：专辑名相同、专辑艺人（缺则艺人）相同、在同一个文件夹里。宿主给的封面地址按曲目
 * 文件拼，同一张专辑的各首地址也各不相同，只能按元数据认。合辑里各首内嵌的图不同时会认成同一张，新图到了
 * 不带过渡直接换。
 */
export function sameAlbum(a: Track, b: Track): boolean {
  if (!a.album || a.album !== b.album) return false;
  const artist = (track: Track) => track.albumArtist || track.artist;
  return artist(a) === artist(b) && folderOf(a.path) === folderOf(b.path);
}

export interface SwapContext {
  readonly intent: SkipIntent | null;
  readonly now: number;
  /** 上一首最后报的进度与总长，秒。 */
  readonly position: number;
  readonly duration: number;
}

export type SwapPlan = Pick<TrackSwap, 'kind' | 'direction' | 'sameCover'>;

/**
 * 从 `from` 换到 `to` 算不算一次换曲、怎么翻；不算的答 null。同一首的标签被编辑不算；同一路流报了新
 * 曲名或艺人算电台换曲。方向：按键留下的方向还新鲜就用它；否则上一首播到了结尾附近算下一首；
 * 别的来源（列表双击、媒体键、托盘、随机）认不出方向。
 */
export function swapOf(
  from: Track | null,
  to: Track | null,
  context: SwapContext,
): SwapPlan | null {
  if (trackKeyOf(from) === trackKeyOf(to)) {
    if (!from || !to || !isStream(to)) return null;
    if (from.title === to.title && from.artist === to.artist) return null;
    return { kind: 'refresh', direction: 'none', sameCover: true };
  }
  if (!from) return { kind: 'enter', direction: 'none', sameCover: false };
  if (!to) return { kind: 'leave', direction: 'none', sameCover: false };
  const { intent, now, position, duration } = context;
  const direction =
    intent && fresh(intent, now)
      ? intent.direction
      : duration > 0 && position >= duration - NATURAL_END_S
        ? 'next'
        : 'none';
  return { kind: 'track', direction, sameCover: sameAlbum(from, to) };
}

export interface TrackSwapSources {
  readonly track: Atom<Track | null>;
  readonly progress: Atom<Pick<PlaybackState, 'track' | 'position' | 'duration'>>;
}

export interface TrackSwapService {
  dispose(): void;
}

/**
 * 跟着正在播放的曲目记换曲。进度只记当前这一首的：宿主换曲时进度与曲目在同一次更新里一起变，报来的进度
 * 属于新一首的一律不记，算方向时用的还是上一首最后报的那个。
 */
export function startTrackSwap(
  store: Store,
  sources: TrackSwapSources = { track: currentTrackAtom, progress: playbackAtom },
  now: () => number = () => performance.now(),
): TrackSwapService {
  store.set(swapAtom, INITIAL);
  store.set(intentAtom, null);
  let shown = store.get(sources.track);
  let position = 0;
  let duration = 0;

  const record = () => {
    const state = store.get(sources.progress);
    if (trackKeyOf(state.track) !== trackKeyOf(shown)) return;
    position = state.position;
    duration = state.duration;
  };

  const follow = () => {
    const next = store.get(sources.track);
    const intent = store.get(intentAtom);
    const at = now();
    const plan = swapOf(shown, next, { intent, now: at, position, duration });
    const moved = trackKeyOf(shown) !== trackKeyOf(next);
    shown = next;
    if (moved) {
      position = 0;
      duration = 0;
      record();
    }
    if (!plan) return;
    if (
      plan.kind === 'track' &&
      intent &&
      fresh(intent, at) &&
      plan.direction === intent.direction
    ) {
      store.set(intentAtom, { ...intent, pending: intent.pending - 1 });
    }
    store.set(swapAtom, { ...plan, serial: store.get(swapAtom).serial + 1, at });
  };

  const offProgress = store.sub(sources.progress, record);
  const offTrack = store.sub(sources.track, follow);
  record();
  return {
    dispose() {
      offProgress();
      offTrack();
    },
  };
}
