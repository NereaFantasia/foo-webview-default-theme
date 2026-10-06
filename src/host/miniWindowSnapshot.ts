import { recordOf, storedRecord } from '../kit/localPref.ts';
import type { PagePrefStorage } from '../kit/prefStorage.ts';

export const MINI_WINDOW_STORAGE_KEY = 'default-theme.mini-window.v1';

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MiniWindowSnapshot {
  readonly bounds: WindowBounds;
  readonly min: { readonly width: number; readonly height: number };
  readonly max: { readonly width: number; readonly height: number };
  readonly maximized: boolean;
  readonly fullscreen: boolean;
  readonly pinned: boolean;
  readonly resizable: boolean;
}

export type MiniWindowStorage = Pick<
  PagePrefStorage,
  'getItem' | 'setItem' | 'settled' | 'saveState'
>;

export function readMiniWindowSnapshot(storage: MiniWindowStorage): MiniWindowSnapshot | null {
  const value = storedRecord(storage.getItem(MINI_WINDOW_STORAGE_KEY));
  const bounds = recordOf(value['bounds']);
  const min = recordOf(value['min']);
  const max = recordOf(value['max']);
  const { x, y, width, height } = bounds;
  const { maximized, fullscreen, pinned, resizable } = value;
  const valid = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100_000;
  if (
    !valid(x) ||
    !valid(y) ||
    !valid(width) ||
    !valid(height) ||
    width <= 0 ||
    height <= 0 ||
    !valid(min['width']) ||
    !valid(min['height']) ||
    min['width'] < 0 ||
    min['height'] < 0 ||
    !valid(max['width']) ||
    !valid(max['height']) ||
    max['width'] < 0 ||
    max['height'] < 0 ||
    typeof maximized !== 'boolean' ||
    typeof fullscreen !== 'boolean' ||
    typeof pinned !== 'boolean' ||
    typeof resizable !== 'boolean'
  )
    return null;
  return {
    bounds: { x, y, width, height },
    min: { width: min['width'], height: min['height'] },
    max: { width: max['width'], height: max['height'] },
    maximized,
    fullscreen,
    pinned,
    resizable,
  };
}

/** 恢复记录须先落盘；否则退出进程后宿主只剩迷你尺寸，无法找回原窗口。 */
export async function saveMiniWindowSnapshot(
  storage: MiniWindowStorage,
  snapshot: MiniWindowSnapshot | null,
): Promise<boolean> {
  storage.setItem(MINI_WINDOW_STORAGE_KEY, JSON.stringify(snapshot));
  await storage.settled();
  return storage.saveState(MINI_WINDOW_STORAGE_KEY)?.status === 'saved';
}
