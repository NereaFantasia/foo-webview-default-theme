import { expect, type Page } from '@playwright/test';
import type { Track } from 'foo-webview-sdk';
import { PLAYER_BAR_STORAGE_KEY, type PlayerBarStyle } from '../../src/theme/playerBarStyle.ts';
import { collectPageErrors, installPageHost, type PageHost } from './pageHost.ts';
import { makeTrack } from './tracks.ts';

// 播放栏的 e2e 共用：装一台正在放歌的宿主替身再打开页面。宿主那边的状态放在一个可改的对象里，
// 各读取按它此刻的值作答，用例改了它再推事件，回读就与事件对得上。

export const PLAYING_TRACK: Track = makeTrack({
  title: 'Luv (sic) Part 3',
  artist: 'Nujabes feat. Shing02',
  duration: 240,
});

export interface PlayerHostState {
  state: 'playing' | 'paused' | 'stopped';
  canSeek: boolean;
  track: Track | null;
  position: number;
  volumeDb: number;
  muted: boolean;
  /** 宿主的顺序编号 0–6，与 `ORDER_IDS` 同序。 */
  order: number;
  /** `%__encoding%|%__bitspersample%` 的求值结果。 */
  format: string;
}

export interface PlayerPage {
  readonly host: PageHost;
  readonly errors: string[];
  readonly state: PlayerHostState;
  /** 宿主调用的参数，按先后。 */
  calls(method: Parameters<PageHost['callsTo']>[0]): ReturnType<PageHost['callsTo']>;
}

export interface OpenPlayerOptions {
  readonly width?: number;
  readonly state?: Partial<PlayerHostState>;
  /** 换成 `appHarnessEntry.ts` 这个入口，运行中能用 `switchPreference` 改偏好。 */
  readonly harness?: boolean;
}

const HARNESS_ENTRY = "import '/tests/fixtures/appHarnessEntry.ts';";

const ORDER_NAMES = [
  'default',
  'repeat-playlist',
  'repeat-track',
  'random',
  'shuffle-tracks',
  'shuffle-albums',
  'shuffle-folders',
] as const;

export async function openPlayer(page: Page, options: OpenPlayerOptions = {}): Promise<PlayerPage> {
  await page.setViewportSize({ width: options.width ?? 1280, height: 800 });
  const errors = collectPageErrors(page);
  const state: PlayerHostState = {
    state: 'playing',
    canSeek: true,
    track: PLAYING_TRACK,
    position: 42,
    volumeDb: -20,
    muted: false,
    order: 0,
    format: 'lossless|16',
    ...options.state,
  };
  const host = await installPageHost(page);
  host.answer('playback.getState', () => ({
    success: true,
    state: state.state,
    canSeek: state.canSeek,
    canPause: state.state !== 'stopped',
  }));
  host.answer('playback.getCurrentTrack', () =>
    state.track
      ? { success: true, found: true, track: state.track }
      : { success: true, found: false },
  );
  host.answer('playback.getPosition', () => ({
    success: true,
    hostTime: Date.now(),
    position: state.position,
    duration: state.track?.duration ?? 0,
    subsong: state.track?.subsong ?? 0,
    path: state.track?.path ?? '',
  }));
  host.answer('playback.setPosition', (params) => {
    const duration = state.track?.duration ?? 0;
    const requested = Number(params['position'] ?? 0);
    const oldPosition = state.position;
    state.position = Math.min(duration, Math.max(0, requested));
    return {
      success: true,
      requestedPosition: requested,
      hostTime: Date.now(),
      actualPosition: state.position,
      oldPosition,
      newPosition: state.position,
      duration,
      subsong: state.track?.subsong ?? 0,
    };
  });
  host.answer('playback.getVolume', () => ({
    success: true,
    volume: Math.round(100 * 10 ** (state.volumeDb / 20)),
    volumeDb: state.volumeDb,
    muted: state.muted,
    isMuted: state.muted,
  }));
  host.answer('playback.getPlaybackOrder', () => {
    const name = ORDER_NAMES[state.order] ?? 'default';
    return { success: true, order: state.order, orderName: name, name, orderIndex: state.order };
  });
  host.answer('titleformat.eval', (params) => ({
    success: true,
    path: state.track?.path ?? '',
    pattern: String(params['pattern'] ?? ''),
    result: state.format,
    infoAvailable: true,
  }));
  // 入口照表格试验页的做法换：页面仍由开发服务器给，只把 src/main.tsx 换成一句导入。
  if (options.harness) {
    await page.route('**/src/main.tsx', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: HARNESS_ENTRY }),
    );
  }
  await page.goto('/');
  if (state.track) await expect(page.getByText(state.track.title).first()).toBeVisible();
  return { host, errors, state, calls: (method) => host.callsTo(method) };
}

/** 元素的边框盒，取整到像素。 */
export function boxOf(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      };
    });
}

/**
 * 页面打开之前定下播放栏的形态（写 localStorage）；在 `openPlayer`、`page.goto` 之前调。缺省的形态是
 * 底部通栏，标题栏播放与胶囊的用例要调这个换成 `titlebar`。
 */
export async function choosePlayerBar(page: Page, style: PlayerBarStyle): Promise<void> {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    PLAYER_BAR_STORAGE_KEY,
    style,
  ] as const);
}

/**
 * 运行中改一项偏好，照设置页那样调写入口；页面要用 `harness: true` 打开。调的是 `appHarnessEntry.ts` 挂在
 * window 上的 `__harness.set`：先等它挂上（开发服务器可能在这时整页重载），它没认这个值就直接报错。
 */
export async function switchPreference(
  page: Page,
  preference: 'player-bar' | 'volume-scale',
  value: string,
): Promise<void> {
  await page.waitForFunction(() => '__harness' in window);
  const accepted = await page.evaluate(
    ([name, next]) => {
      const harness: unknown = Reflect.get(window, '__harness');
      const set: unknown =
        typeof harness === 'object' && harness !== null ? Reflect.get(harness, 'set') : undefined;
      return typeof set === 'function' ? Boolean(set(name, next)) : false;
    },
    [preference, value] as const,
  );
  expect(accepted, `试验页没收下 ${preference} = ${value}`).toBe(true);
}
