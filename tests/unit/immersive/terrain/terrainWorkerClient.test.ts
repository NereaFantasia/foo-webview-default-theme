import { afterEach, describe, expect, test, vi } from 'vitest';
import { setPaintFpsCap } from '../../../../src/immersive/frame/frameScheduler.ts';
import type { PaintStats } from '../../../../src/immersive/perf/paintMeter.ts';
import {
  createSpectrumHistory,
  type SpectrumHistory,
} from '../../../../src/immersive/terrain/terrain.ts';
import type { TerrainPaintSettings } from '../../../../src/immersive/terrain/terrainPainter.ts';
import {
  createWorkerTerrainPainter,
  isTerrainWorkerMessage,
  isTerrainWorkerReply,
  mirrorRows,
  type TerrainRowsMessage,
  type TerrainWorkerMessage,
} from '../../../../src/immersive/terrain/terrainWorkerClient.ts';

/**
 * 山脊图 Worker 的主线程一端：初始化与 canvas 转移、按行补发缓冲、镜像逐行对得上主线程的缓冲、
 * 重画上限跟着带、绘制计时的开关与回报、释放即终止。Worker 由记录消息的替身顶替，canvas 换成一块 ArrayBuffer。
 */
const SETTINGS: TerrainPaintSettings = {
  width: 400,
  height: 200,
  pixelRatio: 1,
  lineColor: 'red',
  horizonRatio: 0.5,
  alphaNear: 0.3,
  alphaFar: 0.1,
  curve: true,
  frameInterval: 1000 / 60,
  glide: true,
  frozen: false,
};

function fakePort() {
  const sent: { message: TerrainWorkerMessage<ArrayBuffer>; transfer: Transferable[] }[] = [];
  let terminated = 0;
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  return {
    sent,
    terminated: () => terminated,
    listeners,
    /** 假装 Worker 发回一条消息。 */
    reply: (data: unknown) => {
      for (const listener of listeners) listener(new MessageEvent('message', { data }));
    },
    port: {
      postMessage: (message: TerrainWorkerMessage<ArrayBuffer>, transfer: Transferable[]) => {
        sent.push({ message, transfer });
      },
      addEventListener: (_type: 'message', listener: (event: MessageEvent<unknown>) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: 'message', listener: (event: MessageEvent<unknown>) => void) => {
        listeners.delete(listener);
      },
      terminate: () => {
        terminated += 1;
      },
    },
  };
}

const rowsSent = (sent: ReturnType<typeof fakePort>['sent']): TerrainRowsMessage[] =>
  sent.flatMap(({ message }) => (message.type === 'rows' ? [message] : []));

/** 第 n 帧：每个值都是 n / 100，读出来就知道是哪一帧。 */
const frameOf = (bands: number, n: number) => new Array<number>(bands).fill(n / 100);

afterEach(() => setPaintFpsCap(null));

describe('createWorkerTerrainPainter', () => {
  test('初始化透传 GPU 探测开关，独立回报后端；销毁后不再回报', () => {
    const { port, sent, reply } = fakePort();
    const ready = vi.fn();
    const painter = createWorkerTerrainPainter(
      port,
      new ArrayBuffer(8),
      () => createSpectrumHistory(4, 3),
      SETTINGS,
      false,
      ready,
    );
    expect(sent[0]?.message).toMatchObject({ type: 'init', gpu: false });
    reply({ type: 'ready', surface: '2d' });
    reply({ type: 'ready', surface: 'other' });
    expect(ready).toHaveBeenCalledExactlyOnceWith('2d');
    painter.dispose();
    reply({ type: 'ready', surface: 'webgl' });
    expect(ready).toHaveBeenCalledOnce();
  });
  test('init 带设置、canvas 进 transfer；挂载时存量行按从旧到新补发，不算新到的帧；空缓冲也发一次 reset', () => {
    const history = createSpectrumHistory(4, 3);
    for (let n = 1; n <= 2; n += 1) history.push(frameOf(3, n));
    const { port, sent } = fakePort();
    const canvas = new ArrayBuffer(8);
    createWorkerTerrainPainter(port, canvas, () => history, SETTINGS);
    expect(sent[0]?.message.type).toBe('init');
    expect(sent[0]?.transfer).toHaveLength(1);
    expect(sent[0]?.transfer[0]).toBe(canvas);
    const [rows] = rowsSent(sent);
    expect(rows?.reset).toBe(true);
    expect(rows?.arrived).toBe(false);
    expect([...(rows?.data ?? [])].map((value) => Math.round(value * 100))).toStrictEqual([
      1, 1, 1, 2, 2, 2,
    ]);
    expect(sent.at(-1)?.transfer).toHaveLength(1);
    expect(sent.at(-1)?.transfer[0]).toBe(rows?.data.buffer);

    const empty = fakePort();
    createWorkerTerrainPainter(
      empty.port,
      new ArrayBuffer(8),
      () => createSpectrumHistory(4, 3),
      SETTINGS,
    );
    expect(rowsSent(empty.sent).map(({ reset, data }) => [reset, data.length])).toStrictEqual([
      [true, 0],
    ]);
  });

  test('每来一帧只发镜像还没有的行；攒了几行就按从旧到新发几行，超过 rows 只发 rows 行；没有新行不发', () => {
    const history = createSpectrumHistory(4, 2);
    const { port, sent } = fakePort();
    const painter = createWorkerTerrainPainter(port, new ArrayBuffer(8), () => history, SETTINGS);
    history.push(frameOf(2, 1));
    painter.frameArrived();
    history.push(frameOf(2, 2));
    history.push(frameOf(2, 3));
    painter.frameArrived();
    for (let n = 4; n <= 9; n += 1) history.push(frameOf(2, n));
    painter.frameArrived();
    const before = sent.length;
    painter.frameArrived();
    expect(sent).toHaveLength(before);
    const batches = rowsSent(sent).slice(1);
    expect(
      batches.map(({ data, reset, arrived }) => ({
        frames: [...data]
          .filter((_, index) => index % 2 === 0)
          .map((value) => Math.round(value * 100)),
        reset,
        arrived,
      })),
    ).toStrictEqual([
      { frames: [1], reset: false, arrived: true },
      { frames: [2, 3], reset: false, arrived: true },
      { frames: [6, 7, 8, 9], reset: false, arrived: true },
    ]);
  });

  test('镜像逐行对得上主线程带保留量写入的缓冲；缓冲换了对象就整份重发并重建镜像', () => {
    let history: SpectrumHistory = createSpectrumHistory(6, 5);
    const { port, sent } = fakePort();
    const painter = createWorkerTerrainPainter(port, new ArrayBuffer(8), () => history, SETTINGS);
    for (let n = 1; n <= 9; n += 1) {
      history.push(
        Array.from({ length: 5 }, (_, band) => ((n * 7 + band * 3) % 10) / 10),
        0.4,
      );
      painter.frameArrived();
    }
    let mirror = createSpectrumHistory(1, 2);
    for (const message of rowsSent(sent)) mirror = mirrorRows(mirror, message);
    for (let k = 0; k < history.rows; k += 1) {
      expect([...mirror.row(k)], `行 ${k}`).toStrictEqual([...history.row(k)]);
    }

    const replaced = mirror;
    history = createSpectrumHistory(6, 5);
    history.push(frameOf(5, 42));
    painter.frameArrived();
    const last = rowsSent(sent).at(-1);
    expect(last?.reset).toBe(true);
    if (!last) return;
    mirror = mirrorRows(mirror, last);
    expect(mirror).not.toBe(replaced);
    expect(mirror.count).toBe(1);
    expect([...mirror.row(0)]).toStrictEqual([...history.row(0)]);
  });

  test('update 原样转发；重画上限变了随下一条消息带过去，不变不发', () => {
    const { port, sent } = fakePort();
    const history = createSpectrumHistory(4, 2);
    const painter = createWorkerTerrainPainter(port, new ArrayBuffer(8), () => history, SETTINGS);
    painter.update({ lineColor: 'blue', frozen: true });
    expect(sent.at(-1)?.message).toStrictEqual({
      type: 'update',
      settings: { lineColor: 'blue', frozen: true },
    });
    const caps = () =>
      sent.flatMap(({ message }) => (message.type === 'paintCap' ? [message.fps] : []));
    expect(caps()).toStrictEqual([]);
    setPaintFpsCap(30);
    history.push(frameOf(2, 1));
    painter.frameArrived();
    painter.update({});
    setPaintFpsCap(null);
    painter.update({});
    expect(caps()).toStrictEqual([30, null]);
  });

  test('dispose 终止 Worker 一次，之后不再发消息；判别字段之外的消息 Worker 不认', () => {
    const { port, sent, terminated, listeners } = fakePort();
    const history = createSpectrumHistory(4, 2);
    const painter = createWorkerTerrainPainter(port, new ArrayBuffer(8), () => history, SETTINGS);
    const before = sent.length;
    painter.dispose();
    painter.dispose();
    history.push(frameOf(2, 1));
    painter.frameArrived();
    painter.update({ lineColor: 'blue' });
    expect(terminated()).toBe(1);
    expect(listeners.size).toBe(0);
    expect(sent).toHaveLength(before);

    expect(isTerrainWorkerMessage({ type: 'rows' })).toBe(true);
    expect(isTerrainWorkerMessage({ type: 'meter', on: true })).toBe(true);
    for (const value of [null, 'rows', 3, {}, { type: 'draw' }]) {
      expect(isTerrainWorkerMessage(value), JSON.stringify(value)).toBe(false);
    }
  });

  test('meter 只在开关切换时通知 Worker；回来的统计连同上下文种类转给当前回调，字段不对的丢掉，释放后不再转', () => {
    const { port, sent, reply } = fakePort();
    const history = createSpectrumHistory(4, 2);
    const painter = createWorkerTerrainPainter(port, new ArrayBuffer(8), () => history, SETTINGS);
    const meters = () =>
      sent.flatMap(({ message }) => (message.type === 'meter' ? [message.on] : []));
    const first: [PaintStats, string][] = [];
    const second: [PaintStats, string][] = [];
    const stats: PaintStats = { paints: 40, totalMs: 80, maxMs: 4, spanMs: 500 };

    painter.meter(null);
    painter.meter((value, surface) => first.push([value, surface]));
    painter.meter((value, surface) => second.push([value, surface]));
    expect(meters()).toStrictEqual([true]);

    reply({ type: 'paintStats', stats, surface: 'webgl' });
    reply({ type: 'paintStats', stats: { ...stats, maxMs: 'slow' }, surface: 'webgl' });
    reply({ type: 'paintStats', stats, surface: 'canvas' });
    reply({ type: 'paintStats', stats });
    reply({ type: 'rows', stats });
    reply(null);
    expect(first).toStrictEqual([]);
    expect(second).toStrictEqual([[stats, 'webgl']]);

    painter.meter(null);
    expect(meters()).toStrictEqual([true, false]);
    reply({ type: 'paintStats', stats, surface: '2d' });
    painter.meter((value, surface) => second.push([value, surface]));
    painter.dispose();
    reply({ type: 'paintStats', stats, surface: '2d' });
    expect(second).toStrictEqual([[stats, 'webgl']]);
    expect(meters()).toStrictEqual([true, false, true]);
  });
});

describe('isTerrainWorkerReply', () => {
  test('统计四个字段都得是有限数，上下文种类只认 webgl 与 2d', () => {
    const stats: PaintStats = { paints: 40, totalMs: 80, maxMs: 4, spanMs: 500 };
    expect(isTerrainWorkerReply({ type: 'paintStats', stats, surface: '2d' })).toBe(true);
    expect(
      isTerrainWorkerReply({
        type: 'paintStats',
        stats: { ...stats, spanMs: Infinity },
        surface: '2d',
      }),
    ).toBe(false);
    expect(isTerrainWorkerReply({ type: 'paintStats', stats, surface: 'canvas' })).toBe(false);
  });
});
