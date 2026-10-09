import { describe, expect, test, vi } from 'vitest';
import type { PaintStats } from '../../../../src/immersive/perf/paintMeter.ts';
import type { TerrainThread } from '../../../../src/immersive/perf/perfOverlay.ts';
import {
  createSpectrumHistory,
  type SpectrumHistory,
} from '../../../../src/immersive/terrain/terrain.ts';
import {
  mountTerrain,
  type TerrainBackends,
} from '../../../../src/immersive/terrain/terrainMount.ts';
import type {
  TerrainPainter,
  TerrainPaintSettings,
  TerrainSurfaceKind,
} from '../../../../src/immersive/terrain/terrainPainter.ts';

/**
 * 山脊图挂在哪条路上画：Worker → 主线程 WebGL2 → 主线程 2D 逐级退，每退一步换一块新 canvas，
 * 新画师照最新的设置起步、计时回报跟过去；旧画师晚到的出错不理，换数据来源时不再试退掉的路，释放后什么都不做。
 * 后端换成记账的假实现：canvas 只是编号，画师记下收到的调用，出错与丢上下文由用例触发。
 */
const SETTINGS: TerrainPaintSettings = {
  width: 0,
  height: 0,
  pixelRatio: 1,
  lineColor: '',
  horizonRatio: 0.5,
  alphaNear: 0.3,
  alphaFar: 0.1,
  curve: true,
  frameInterval: 1000 / 60,
  glide: true,
  frozen: false,
};

const STATS: PaintStats = { paints: 3, totalMs: 1.5, maxMs: 0.7, spanMs: 500 };

type Path = 'worker' | 'webgl' | '2d';

interface FakePainter {
  readonly path: Path;
  readonly canvas: number;
  readonly initial: TerrainPaintSettings;
  readonly history: () => SpectrumHistory;
  readonly updates: Partial<TerrainPaintSettings>[];
  arrived: number;
  report: ((stats: PaintStats, surface: TerrainSurfaceKind) => void) | null;
  disposed: boolean;
  /** Worker 出错，或主线程 WebGL2 的上下文丢了。 */
  readonly fail: () => void;
}

interface BackendOptions {
  /** 能不能转给 Worker；缺省能。 */
  worker?: boolean;
  /** 主线程 WebGL2：`ok` 建得起，`throw` 开了上下文却建不起渲染器，`none` 探测不过；缺省 `ok`。 */
  gpu?: 'ok' | 'throw' | 'none';
  /** 主线程要不要得到 2D 上下文；缺省要得到。 */
  context2d?: boolean;
}

function fakeBackends({ worker = true, gpu = 'ok', context2d = true }: BackendOptions = {}) {
  const log: string[] = [];
  const painters: FakePainter[] = [];
  let created = 0;
  let current = 0;

  function painter(
    path: Path,
    history: () => SpectrumHistory,
    initial: TerrainPaintSettings,
    fail: () => void,
  ): TerrainPainter {
    const fake: FakePainter = {
      path,
      canvas: current,
      initial,
      history,
      updates: [],
      arrived: 0,
      report: null,
      disposed: false,
      fail,
    };
    painters.push(fake);
    return {
      surface: path === 'worker' ? undefined : path === 'webgl' ? 'webgl' : '2d',
      update: (changes) => fake.updates.push(changes),
      frameArrived: () => {
        fake.arrived += 1;
      },
      meter: (report) => {
        fake.report = report;
      },
      dispose: () => {
        fake.disposed = true;
      },
    };
  }

  const releaseCanvas = (): void => {
    if (current) log.push(`release ${current}`);
    current = 0;
  };

  const backends: TerrainBackends = {
    replaceCanvas() {
      releaseCanvas();
      created += 1;
      current = created;
      log.push(`canvas ${current}`);
    },
    releaseCanvas,
    startWorker(history, settings, onError) {
      return worker ? painter('worker', history, settings, onError) : null;
    },
    startMain(history, settings, tryGpu, onLost) {
      if (tryGpu && gpu === 'throw') throw new Error('建不起渲染器');
      if (tryGpu && gpu === 'ok') return painter('webgl', history, settings, onLost);
      return context2d ? painter('2d', history, settings, () => {}) : null;
    },
  };
  return { backends, log, painters };
}

const at = (painters: FakePainter[], index: number): FakePainter => {
  const found = painters[index];
  if (!found) throw new Error(`没有第 ${index} 个画师`);
  return found;
};

function recorder() {
  const reports: { thread: TerrainThread; surface: TerrainSurfaceKind; stats: PaintStats }[] = [];
  const report = (thread: TerrainThread, surface: TerrainSurfaceKind, stats: PaintStats) => {
    reports.push({ thread, surface, stats });
  };
  return { reports, report };
}

describe('mountTerrain', () => {
  test('二十次休眠逐次释放，恢复只建一份画师；旧错误不触发后台重建', () => {
    const { backends, log, painters } = fakeBackends();
    const mount = mountTerrain(backends, SETTINGS);
    const history = createSpectrumHistory(4, 3);
    for (let round = 0; round < 20; round += 1) {
      mount.setHistory(history);
      expect(painters.filter((painter) => !painter.disposed)).toHaveLength(1);
      mount.setHistory(null);
      expect(painters.filter((painter) => !painter.disposed)).toHaveLength(0);
      expect(log.at(-1)).toBe(`release ${round + 1}`);
      at(painters, round).fail();
      expect(painters).toHaveLength(round + 1);
    }
    mount.dispose();
  });

  test('可见退场只留画布，取数来源与画师立即停；随后隐藏立即释放，不等卸载', () => {
    const { backends, log, painters } = fakeBackends();
    const mount = mountTerrain(backends, SETTINGS);
    mount.setHistory(createSpectrumHistory(4, 3));
    mount.setHistory(null, true);
    expect(at(painters, 0).disposed).toBe(true);
    expect(log).toEqual(['canvas 1']);
    at(painters, 0).fail();
    mount.update({ width: 500 });
    mount.frameArrived();
    expect(painters).toHaveLength(1);
    expect(at(painters, 0).arrived).toBe(0);
    mount.setHistory(null);
    expect(log).toEqual(['canvas 1', 'release 1']);
    mount.dispose();
    expect(log).toHaveLength(2);
  });

  test('挂载重建沿用失败记录，不再尝试已失败的 Worker 与 GPU', () => {
    const { backends, painters } = fakeBackends();
    const failures = { worker: false, gpu: false };
    const first = mountTerrain(backends, SETTINGS, failures);
    first.setHistory(createSpectrumHistory(4, 3));
    at(painters, 0).fail();
    at(painters, 1).fail();
    first.dispose();
    const second = mountTerrain(backends, SETTINGS, failures);
    second.setHistory(createSpectrumHistory(4, 3));
    expect(painters.map((painter) => painter.path)).toEqual(['worker', 'webgl', '2d', '2d']);
    second.dispose();
  });

  test('GPU 探测不可用也记住结论，恢复只尝试 2D', () => {
    const { backends } = fakeBackends({ worker: false, gpu: 'none' });
    const startMain = vi.spyOn(backends, 'startMain');
    const mount = mountTerrain(backends, SETTINGS);
    const history = createSpectrumHistory(4, 3);
    mount.setHistory(history);
    mount.setHistory(null);
    mount.setHistory(history);
    expect(startMain.mock.calls.map((args) => args[2])).toEqual([true, false]);
    mount.dispose();
  });

  test('Worker 回报 GPU 不可用后，恢复也不重复探测；旧 Worker 的晚到回报无效', () => {
    const { backends } = fakeBackends();
    const startWorker = vi.spyOn(backends, 'startWorker');
    const mount = mountTerrain(backends, SETTINGS);
    const history = createSpectrumHistory(4, 3);
    mount.setHistory(history);
    mount.setHistory(null);
    startWorker.mock.calls[0]?.[4]('2d');
    mount.setHistory(history);
    startWorker.mock.calls[1]?.[4]('2d');
    mount.setHistory(null);
    mount.setHistory(history);
    expect(startWorker.mock.calls.map((args) => args[3])).toEqual([true, true, false]);
    mount.dispose();
  });

  test('画师清理抛错也撤销画布，下一次释放不重复清理旧画师', () => {
    const releaseCanvas = vi.fn();
    const dispose = vi.fn(() => {
      throw new Error('清理失败');
    });
    const mount = mountTerrain(
      {
        replaceCanvas: vi.fn(),
        releaseCanvas,
        startWorker: () => ({ update() {}, frameArrived() {}, meter() {}, dispose }),
        startMain: () => null,
      },
      SETTINGS,
    );
    mount.setHistory(createSpectrumHistory(4, 3));
    expect(() => mount.setHistory(null)).toThrow('清理失败');
    expect(releaseCanvas).toHaveBeenCalledOnce();
    mount.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  test('能转给 Worker：在第一块 canvas 上起，照当前设置起步并先排一次重画；回报带 worker', () => {
    const { backends, log, painters } = fakeBackends();
    const mount = mountTerrain(backends, SETTINGS);
    const history = createSpectrumHistory(4, 3);
    const { reports, report } = recorder();
    mount.update({ width: 300, height: 200 });
    mount.meter(report);
    expect(painters).toHaveLength(0);

    mount.setHistory(history);
    const worker = at(painters, 0);
    expect(log).toStrictEqual(['canvas 1']);
    expect(worker.path).toBe('worker');
    expect(worker.initial).toStrictEqual({ ...SETTINGS, width: 300, height: 200 });
    expect(worker.history()).toBe(history);
    expect(worker.updates).toStrictEqual([{}]);

    worker.report?.(STATS, 'webgl');
    expect(reports).toStrictEqual([{ thread: 'worker', surface: 'webgl', stats: STATS }]);
    mount.frameArrived();
    mount.update({ alphaNear: 0.2 });
    expect(worker.arrived).toBe(1);
    expect(worker.updates).toStrictEqual([{}, { alphaNear: 0.2 }]);
  });

  test('Worker 出错：旧画师释放，换一块新 canvas 在主线程先试 WebGL2；设置与计时跟过去，线程报 main', () => {
    const { backends, log, painters } = fakeBackends();
    const mount = mountTerrain(backends, SETTINGS);
    const { reports, report } = recorder();
    mount.setHistory(createSpectrumHistory(4, 3));
    mount.meter(report);
    mount.update({ width: 640, height: 400, lineColor: 'blue' });

    at(painters, 0).fail();
    const main = at(painters, 1);
    expect(at(painters, 0).disposed).toBe(true);
    expect(log).toStrictEqual(['canvas 1', 'release 1', 'canvas 2']);
    expect(main.path).toBe('webgl');
    expect(main.canvas).toBe(2);
    expect(main.initial).toStrictEqual({ ...SETTINGS, width: 640, height: 400, lineColor: 'blue' });
    expect(main.updates).toStrictEqual([{}]);
    main.report?.(STATS, 'webgl');
    expect(reports).toStrictEqual([{ thread: 'main', surface: 'webgl', stats: STATS }]);

    // 同一个 Worker 再报一次错（ErrorEvent 之外又来一次），不再换。
    at(painters, 0).fail();
    expect(painters).toHaveLength(2);
    mount.frameArrived();
    expect(at(painters, 0).arrived).toBe(0);
    expect(main.arrived).toBe(1);
  });

  test('不能转给 Worker：同一块 canvas 直接走主线程', () => {
    const { backends, log, painters } = fakeBackends({ worker: false });
    mountTerrain(backends, SETTINGS).setHistory(createSpectrumHistory(4, 3));
    expect(log).toStrictEqual(['canvas 1']);
    expect(painters.map((painter) => painter.path)).toStrictEqual(['webgl']);
  });

  test('WebGL2 开了上下文却建不起：换新 canvas 退到 2D', () => {
    const { backends, log, painters } = fakeBackends({ worker: false, gpu: 'throw' });
    mountTerrain(backends, SETTINGS).setHistory(createSpectrumHistory(4, 3));
    expect(log).toStrictEqual(['canvas 1', 'release 1', 'canvas 2']);
    expect(painters.map((painter) => [painter.path, painter.canvas])).toStrictEqual([['2d', 2]]);
    expect(at(painters, 0).updates).toStrictEqual([{}]);
  });

  test('探测不过：同一块 canvas 直接要 2D', () => {
    const { backends, log, painters } = fakeBackends({ worker: false, gpu: 'none' });
    mountTerrain(backends, SETTINGS).setHistory(createSpectrumHistory(4, 3));
    expect(log).toStrictEqual(['canvas 1']);
    expect(painters.map((painter) => painter.path)).toStrictEqual(['2d']);
  });

  test('WebGL2 上下文丢了：释放旧画师，换新 canvas 退到 2D；再报丢失不理', () => {
    const { backends, log, painters } = fakeBackends({ worker: false });
    mountTerrain(backends, SETTINGS).setHistory(createSpectrumHistory(4, 3));
    at(painters, 0).fail();
    expect(at(painters, 0).disposed).toBe(true);
    expect(painters.map((painter) => [painter.path, painter.canvas])).toStrictEqual([
      ['webgl', 1],
      ['2d', 2],
    ]);
    at(painters, 0).fail();
    expect(painters).toHaveLength(2);
    expect(log).toStrictEqual(['canvas 1', 'release 1', 'canvas 2']);
  });

  test('Worker 与主线程 WebGL2 先后出错：一路退到 2D，共换三块 canvas', () => {
    const { backends, log, painters } = fakeBackends();
    const mount = mountTerrain(backends, SETTINGS);
    const { reports, report } = recorder();
    mount.meter(report);
    mount.setHistory(createSpectrumHistory(4, 3));
    at(painters, 0).fail();
    at(painters, 1).fail();
    expect(painters.map((painter) => [painter.path, painter.canvas])).toStrictEqual([
      ['worker', 1],
      ['webgl', 2],
      ['2d', 3],
    ]);
    expect(log).toStrictEqual(['canvas 1', 'release 1', 'canvas 2', 'release 2', 'canvas 3']);
    at(painters, 2).report?.(STATS, '2d');
    expect(reports).toStrictEqual([{ thread: 'main', surface: '2d', stats: STATS }]);
  });

  test('换数据来源：新对象在新 canvas 上重起，退掉的路不再试；同一个对象不重起；null 时停画、移走 canvas', () => {
    const { backends, log, painters } = fakeBackends();
    const mount = mountTerrain(backends, SETTINGS);
    const first = createSpectrumHistory(4, 3);
    const second = createSpectrumHistory(4, 3);
    mount.setHistory(first);
    at(painters, 0).fail();

    mount.setHistory(second);
    const next = at(painters, 2);
    expect(at(painters, 1).disposed).toBe(true);
    expect(next.path).toBe('webgl');
    expect(next.canvas).toBe(3);
    expect(next.history()).toBe(second);
    mount.setHistory(second);
    expect(painters).toHaveLength(3);

    mount.setHistory(null);
    expect(next.disposed).toBe(true);
    expect(log.at(-1)).toBe('release 3');
    // 没有画师时改的设置也记下，下一个画师照它起步。
    mount.update({ width: 800 });
    mount.frameArrived();
    mount.setHistory(first);
    expect(at(painters, 3).initial.width).toBe(800);
    expect(at(painters, 3).canvas).toBe(4);
  });

  test('meter(null) 停计时；释放后停画、移走 canvas，晚到的出错与之后的调用都不再生效', () => {
    const { backends, log, painters } = fakeBackends();
    const mount = mountTerrain(backends, SETTINGS);
    const { report } = recorder();
    mount.setHistory(createSpectrumHistory(4, 3));
    mount.meter(report);
    expect(at(painters, 0).report).not.toBeNull();
    mount.meter(null);
    expect(at(painters, 0).report).toBeNull();

    mount.dispose();
    expect(at(painters, 0).disposed).toBe(true);
    expect(log).toStrictEqual(['canvas 1', 'release 1']);
    at(painters, 0).fail();
    mount.setHistory(createSpectrumHistory(4, 3));
    mount.update({ width: 10 });
    mount.frameArrived();
    expect(painters).toHaveLength(1);
    expect(at(painters, 0).updates).toStrictEqual([{}]);
    expect(log).toStrictEqual(['canvas 1', 'release 1']);
  });

  test('连 2D 上下文都要不到：不画也不抛，之后的调用照常无害', () => {
    const { backends, painters } = fakeBackends({ worker: false, gpu: 'none', context2d: false });
    const mount = mountTerrain(backends, SETTINGS);
    mount.setHistory(createSpectrumHistory(4, 3));
    mount.update({ width: 10 });
    mount.frameArrived();
    mount.meter(() => {});
    expect(painters).toHaveLength(0);
  });
});
