import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  BATCH_MIN,
  FIRST_BATCH,
  PROBE_COUNT,
  playStatsAtom,
  startPlayStats,
} from '../../../src/library/playStats.ts';
import type { HostParams } from '../../fixtures/fakeHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { trackRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const TRACKS = Array.from({ length: 700 }, (_, at) =>
  trackRow('Album', `t${at}`, { subsong: at === 0 ? 2 : 0 }),
);

function pathsOf(params: HostParams): string[] {
  const paths: unknown = params['paths'];
  return Array.isArray(paths) ? paths.map(String) : [];
}

/** 取统计的串与探测的串各答各的：统计按下标答一行，第 0 首从没播过（foo_playcount 答 N/A）。 */
function evalAnswer(probe: readonly string[]) {
  return (params: HostParams) => {
    const pattern = String(params['pattern']);
    const results = pathsOf(params).map((path, at) => ({
      path,
      success: true,
      result: pattern.startsWith('$if2(%added%')
        ? `2024-01-01 00:00:00|${at === 0 ? 'N/A' : '2024-02-02 00:00:00'}||${at}`
        : (probe[at] ?? ''),
    }));
    return {
      success: true as const,
      pattern,
      total: results.length,
      successCount: results.length,
      errorCount: 0,
      results,
    };
  };
}

function setup(elapsed: number[] = []) {
  const host = installFakeHost();
  const store = createStore();
  let clock = 0;
  const service = startPlayStats(store, host.fb, () => {
    clock += elapsed.shift() ?? 0;
    return clock;
  });
  onTestFinished(() => service.dispose());
  return { host, service, state: () => store.get(playStatsAtom) };
}

describe('探 foo_playcount', () => {
  it('求值前几首的播放次数：有一首答得出就是装了；探过不再探', async () => {
    const { host, service, state } = setup();
    host.answer('titleformat.evalBatch', evalAnswer(['', '0']));
    await service.probe(TRACKS);
    expect(state().available).toBe(true);
    expect(pathsOf(host.callsTo('titleformat.evalBatch')[0] ?? {})).toHaveLength(PROBE_COUNT);
    expect(pathsOf(host.callsTo('titleformat.evalBatch')[0] ?? {})[0]).toBe(
      `${TRACKS[0]?.path}|subsong:2`,
    );
    await service.probe(TRACKS);
    expect(host.callsTo('titleformat.evalBatch')).toHaveLength(1);
  });

  it('都答空串就是没装；探失败时不下结论，下次再探', async () => {
    const { host, service, state } = setup();
    host.answer('titleformat.evalBatch', hostFailure('OPERATION_FAILED'));
    await service.probe(TRACKS);
    expect(state().available).toBeNull();
    host.answer('titleformat.evalBatch', evalAnswer([]));
    await service.probe(TRACKS);
    expect(state().available).toBe(false);
  });
});

describe('取统计', () => {
  it('头一批取定量，之后按耗时换算批量；取完才整份换上', async () => {
    const { host, service, state } = setup([0, 80, 0, 10, 0, 10]);
    const sizes: number[] = [];
    host.answer('titleformat.evalBatch', (params) => {
      sizes.push(pathsOf(params).length);
      expect(state().byHandle).toBeNull();
      return evalAnswer([])(params);
    });
    await service.fetch(TRACKS, 1);
    expect(sizes[0]).toBe(FIRST_BATCH);
    expect(sizes[1]).toBe(BATCH_MIN);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(TRACKS.length);
    expect(state()).toMatchObject({ generation: 1, loading: false });
    expect(state().byHandle?.get(TRACKS[0]?.handle ?? '')).toEqual({
      added: '2024-01-01 00:00:00',
      lastPlayed: '',
      firstPlayed: '',
      playCount: 0,
    });
    expect(state().byHandle?.get(TRACKS[5]?.handle ?? '')?.playCount).toBe(5);
  });

  it('同一代取过不再取；新的一代让还在取的旧一代作废；失败的一代下次重取', async () => {
    const { host, service, state } = setup();
    host.answer('titleformat.evalBatch', evalAnswer([]));
    await service.fetch(TRACKS.slice(0, 3), 1);
    await service.fetch(TRACKS.slice(0, 3), 1);
    expect(host.callsTo('titleformat.evalBatch')).toHaveLength(1);
    const held = host.hold('titleformat.evalBatch');
    const old = service.fetch(TRACKS.slice(0, 3), 2);
    const next = service.fetch(TRACKS.slice(3, 4), 3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    held.release();
    await Promise.all([old, next]);
    expect(state().generation).toBe(3);
    expect([...(state().byHandle?.keys() ?? [])]).toEqual([TRACKS[3]?.handle]);
    host.answer('titleformat.evalBatch', hostFailure('OPERATION_FAILED'));
    await service.fetch(TRACKS.slice(0, 1), 4);
    expect(state()).toMatchObject({ generation: 3, loading: false });
    host.answer('titleformat.evalBatch', evalAnswer([]));
    await service.fetch(TRACKS.slice(0, 1), 4);
    expect(state().generation).toBe(4);
  });
});
