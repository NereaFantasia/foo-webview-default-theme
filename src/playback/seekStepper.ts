import { atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { currentTrackAtom, playbackAtom } from './playback.ts';
import { trackKeyOf, type PlaybackService } from './playbackContract.ts';

/** 宿主的播放位置进入目标的这个范围（秒）即视为定位完成 */
const CONFIRM_TOLERANCE_S = 1.5;
/** 宿主迟迟不确认（如定位失败）时，隔这么久（毫秒）改回按宿主的位置算 */
const CONFIRM_TIMEOUT_MS = 1000;

const positionAtom = atom((get) => get(playbackAtom).position);
const trackKeyAtom = atom((get) => trackKeyOf(get(currentTrackAtom)));

export interface SeekStepper {
  /** 相对目标位置跳转，结果落在 0 与时长之间。连按时从上一次要去的位置接着算，宿主确认之前 `position` 仍是旧值 */
  by(seconds: number): void;
  /** 跳到指定位置，落在 0 与时长之间 */
  to(seconds: number): void;
  /** 丢掉记着的目标，下一次按宿主的位置算 */
  release(): void;
}

/**
 * 快捷键跳转用的定位器：连按方向键、数字键时每一下都以上一下的目标为起点。目标在宿主确认、
 * 超时或换曲后作废，空闲时不订阅任何状态
 */
export function createSeekStepper(
  store: Store,
  playback: Pick<PlaybackService, 'seek'>,
): SeekStepper {
  let target: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stops: readonly (() => void)[] = [];

  function release(): void {
    clearTimeout(timer);
    timer = undefined;
    target = null;
    for (const stop of stops) stop();
    stops = [];
  }

  function go(position: number): void {
    const next = Math.min(Math.max(position, 0), store.get(playbackAtom).duration);
    target = next;
    clearTimeout(timer);
    timer = setTimeout(release, CONFIRM_TIMEOUT_MS);
    if (stops.length === 0) {
      stops = [
        store.sub(positionAtom, () => {
          if (target !== null && Math.abs(store.get(positionAtom) - target) < CONFIRM_TOLERANCE_S) {
            release();
          }
        }),
        store.sub(trackKeyAtom, release),
      ];
    }
    void playback.seek(next);
  }

  return {
    by: (seconds) => go((target ?? store.get(playbackAtom).position) + seconds),
    to: go,
    release,
  };
}
