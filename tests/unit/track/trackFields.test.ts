import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startTrackFields } from '../../../src/track/trackFields.ts';
import type { HostParams } from '../../fixtures/fakeHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { trackRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const SEP = '\u001f';
const track = (name: string, subsong = 0) => trackRow('Album', name, { subsong });

function pathsOf(params: HostParams): string[] {
  const paths: unknown = params['paths'];
  return Array.isArray(paths) ? paths.map(String) : [];
}

/** 每首按路径造一行：第一个字段写 `作曲:<路径>`，第二个字段空，其余给占位 */
function evalAnswer(params: HostParams) {
  const pattern = String(params['pattern']);
  const fields = pattern.split('$char(31)').length;
  const results = pathsOf(params).map((path) => ({
    path,
    success: true,
    result: [`作曲:${path}`, '', 'x', 'y', 'z', 'w', 'v'].slice(0, fields).join(SEP),
  }));
  return {
    success: true as const,
    pattern,
    total: results.length,
    successCount: results.length,
    errorCount: 0,
    results,
  };
}

function setup() {
  const host = installFakeHost();
  const store = createStore();
  const service = startTrackFields(store, host.fb);
  onTestFinished(() => service.dispose());
  host.answer('titleformat.evalBatch', evalAnswer);
  return { host, store, service };
}

describe('取标签字段', () => {
  it('一批行合成一次请求，值按分隔符切回各字段，空值不记', async () => {
    const { host, service, store } = setup();
    const [one, two] = [track('a'), track('b', 2)];
    service.ensure([one, two], ['composer', 'comment']);
    await vi.waitFor(() => expect(service.valuesOf(two)).toBeDefined());
    const calls = host.callsTo('titleformat.evalBatch');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.['pattern']).toBe('[%composer%]$char(31)[%comment%]');
    expect(pathsOf(calls[0] ?? {})).toEqual([one.path, `${two.path}|subsong:2`]);
    expect(service.valuesOf(one)).toEqual({ composer: `作曲:${one.path}` });
    expect(store.get(service.version)).toBeGreaterThan(0);
  });

  it('取过的不再取；缺的字段补问一次，并换成新对象让表格看得出值到了', async () => {
    const { host, service } = setup();
    const row = track('a');
    service.ensure([row], ['composer']);
    await vi.waitFor(() => expect(service.valuesOf(row)).toBeDefined());
    const before = service.valuesOf(row);
    service.ensure([row], ['composer']);
    service.ensure([row], ['composer', 'tagType']);
    await vi.waitFor(() => expect(service.valuesOf(row)?.tagType).toBeDefined());
    expect(host.callsTo('titleformat.evalBatch')).toHaveLength(2);
    expect(service.valuesOf(row)).not.toBe(before);
  });

  it('超过一批的曲目分批请求', async () => {
    const { host, service } = setup();
    const rows = Array.from({ length: 450 }, (_, at) => track(`t${at}`));
    service.ensure(rows, ['composer']);
    await vi.waitFor(() => expect(service.valuesOf(rows[449] ?? track('x'))).toBeDefined());
    expect(host.callsTo('titleformat.evalBatch').map((call) => pathsOf(call).length)).toEqual([
      200, 200, 50,
    ]);
  });

  it('宿主读不出这一行时字段留空、不重问；整批失败则下次还能再问', async () => {
    const { host, service } = setup();
    const [row, other] = [track('a'), track('b')];
    host.answer('titleformat.evalBatch', (params) => ({
      ...evalAnswer(params),
      results: pathsOf(params).map((path) => ({
        path,
        success: true,
        result: '',
        infoAvailable: false,
      })),
    }));
    service.ensure([row], ['composer']);
    await vi.waitFor(() => expect(host.callsTo('titleformat.evalBatch')).toHaveLength(1));
    service.ensure([row], ['composer']);
    expect(service.valuesOf(row)).toBeUndefined();
    expect(host.callsTo('titleformat.evalBatch')).toHaveLength(1);

    host.answer('titleformat.evalBatch', hostFailure('OPERATION_FAILED'));
    service.ensure([other], ['composer']);
    await vi.waitFor(() => expect(host.callsTo('titleformat.evalBatch')).toHaveLength(2));
    host.answer('titleformat.evalBatch', evalAnswer);
    service.ensure([other], ['composer']);
    await vi.waitFor(() => expect(service.valuesOf(other)).toBeDefined());
  });

  it('库里的标签改了：缓存作废、版本加一，再画出来时重取', async () => {
    const { host, service, store } = setup();
    const row = track('a');
    service.ensure([row], ['composer']);
    await vi.waitFor(() => expect(service.valuesOf(row)).toBeDefined());
    const before = store.get(service.version);
    await vi.waitFor(() => expect(host.listenerCount('library:itemsModified')).toBe(1));
    host.emit('library:itemsModified', {
      count: 1,
      handles: [],
      truncated: false,
      fromHook: false,
      timestamp: 1,
    });
    expect(service.valuesOf(row)).toBeUndefined();
    expect(store.get(service.version)).toBe(before + 1);
    service.ensure([row], ['composer']);
    await vi.waitFor(() => expect(service.valuesOf(row)).toBeDefined());
    expect(host.callsTo('titleformat.evalBatch')).toHaveLength(2);
  });
});
