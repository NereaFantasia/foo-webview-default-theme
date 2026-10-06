import { atom, type Atom } from 'jotai/vanilla';
import { defineLocalPref, ON_OFF, type PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import { METER_WINDOW_MS, type PaintStats } from './paintMeter.ts';
import type { TerrainSurfaceKind } from '../terrain/terrainPainter.ts';

/**
 * 沉浸视图的性能小窗：开关、山脊图的绘制回报与小窗的四行字。开关与回报放在 store 里，小窗、山脊图与
 * 设置页各自读同一份 atom，不经 props 传。
 *
 * 开关存 localStorage，存 `on` / `off`，缺省关；没有存档、存储被禁或取值认不出都按关。关着时山脊图不该计时、
 * 小窗不该采样；回报在关着时丢掉，关掉时清空上一份。开关键要登记进命令登记处，由它调
 * `togglePerfOverlay`。
 */
const enabledPref = defineLocalPref({
  key: 'default-theme.immersive.perfOverlay.v1',
  fallback: false,
  ...ON_OFF,
});

/** 山脊图在 Worker 里还是主线程上画。 */
export type TerrainThread = 'worker' | 'main';

export interface TerrainReport extends PaintStats {
  thread: TerrainThread;
  /** 画山脊图的上下文：WebGL2，或 canvas 2D。 */
  surface: TerrainSurfaceKind;
  /** 收到回报的时刻（主线程 `performance.now()`，毫秒）；隔太久没来就当停画了。 */
  at: number;
}

const terrainAtom = atom<TerrainReport | null>(null);

/** 性能小窗开着没有。 */
export const perfOverlayEnabledAtom: Atom<boolean> = enabledPref.atom;
/** 山脊图最近一次的绘制回报；小窗关着时恒为 `null`。 */
export const perfTerrainAtom: Atom<TerrainReport | null> = atom((get) => get(terrainAtom));

/**
 * 读存档写进 `store`。整页在首帧之前或头一次进沉浸视图之前调一次：再调会拿存档盖掉 store 里的值，
 * 存储被禁时这次启动里切过的就丢了。
 */
export function loadPerfOverlay(store: Store, storage?: PrefStorage | null): void {
  if (!enabledPref.load(store, storage)) store.set(terrainAtom, null);
}

/** 开或关并记住，立即生效；和此刻一样就不写。关掉时清空上一份回报。 */
export function choosePerfOverlay(
  store: Store,
  enabled: boolean,
  storage?: PrefStorage | null,
): void {
  if (enabledPref.set(store, enabled, storage) && !enabled) store.set(terrainAtom, null);
}

/** 开关键调它：开着就关，关着就开。 */
export function togglePerfOverlay(store: Store, storage?: PrefStorage | null): void {
  choosePerfOverlay(store, !store.get(enabledPref.atom), storage);
}

/** 山脊图每个统计窗回报一次；`at` 缺省取此刻的 `performance.now()`。 */
export function reportTerrain(
  store: Store,
  thread: TerrainThread,
  surface: TerrainSurfaceKind,
  stats: PaintStats,
  at: number = performance.now(),
): void {
  if (store.get(enabledPref.atom)) store.set(terrainAtom, { ...stats, thread, surface, at });
}

export interface PerfSnapshot {
  /** 主线程动画帧回调：每秒次数与相邻两次的最长间隔（毫秒）。 */
  raf: { perSecond: number; maxGapMs: number };
  /** 长动画帧：每秒个数与最长一帧（毫秒）；环境不支持时为 `null`。 */
  loaf: { perSecond: number; maxMs: number } | null;
  /** 宿主每秒推来的频谱帧数。 */
  hostPerSecond: number;
  terrain: TerrainReport | null;
}

/** 一窗里的次数换成每秒次数；窗长（毫秒）不大于 0 时给 0。 */
export const perSecondOf = (count: number, spanMs: number): number =>
  spanMs > 0 ? (count * 1000) / spanMs : 0;
const perSecond = (value: number): string => `${Math.round(value)}/s`;
const ms = (value: number): string => `${value.toFixed(1)} ms`;
/** 一行：标签占 8 列，第一格右对齐到 6 列，四行的每秒次数上下对齐。 */
const row = (label: string, value: string, ...rest: string[]): string =>
  [label.padEnd(8) + value.padStart(6), ...rest].join('  ');

/** 山脊图画在哪条线程、用哪种上下文，如 `worker/webgl`。 */
const where = (terrain: TerrainReport): string => `${terrain.thread}/${terrain.surface}`;

/** 小窗的四行字，`now` 与回报的 `at` 同一个时钟。山脊图超过两个统计窗没有回报就当停画了，写 idle。 */
export function formatPerf(snapshot: PerfSnapshot, now: number): string[] {
  const { raf, loaf, terrain } = snapshot;
  const live = terrain !== null && now - terrain.at <= 2 * METER_WINDOW_MS;
  return [
    row('rAF', perSecond(raf.perSecond), `max gap ${ms(raf.maxGapMs)}`),
    loaf ? row('LoAF', perSecond(loaf.perSecond), `max ${ms(loaf.maxMs)}`) : row('LoAF', 'n/a'),
    live
      ? row(
          'terrain',
          perSecond(perSecondOf(terrain.paints, terrain.spanMs)),
          `draw ${ms(terrain.paints > 0 ? terrain.totalMs / terrain.paints : 0)}`,
          `max ${ms(terrain.maxMs)}`,
          where(terrain),
        )
      : row('terrain', 'idle', ...(terrain ? [where(terrain)] : [])),
    row('host', perSecond(snapshot.hostPerSecond)),
  ];
}
