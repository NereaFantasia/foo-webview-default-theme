import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  autoplaylistPreviewAtom,
  startAutoplaylistPreview,
} from '../../../../src/track/autoplaylist/autoplaylistPreview.ts';
import { QUERY_DEBOUNCE_MS } from '../../../../src/track/queryInput.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const found = (total: number) => ({ success: true as const, tracks: [], total });

function setup(host: UnitHost) {
  vi.useFakeTimers();
  const store = createStore();
  const service = startAutoplaylistPreview(store, host.fb);
  return { service, state: () => store.get(autoplaylistPreviewAtom) };
}

describe('startAutoplaylistPreview', () => {
  it('查询空白不问宿主，预览是空的', async () => {
    const host = installFakeHost();
    const { service, state } = setup(host);
    service.request('   ');
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS);
    expect(host.callsTo('library.query')).toEqual([]);
    expect(state()).toEqual({ status: 'idle' });
  });

  it('静默期后问宿主一次，只要总数：取一行、字段只留句柄、不带排序', async () => {
    const host = installFakeHost();
    host.answer('library.query', found(4217));
    const { service, state } = setup(host);
    service.request('%rating% GREATER 3');
    expect(state()).toEqual({ status: 'pending', query: '%rating% GREATER 3' });
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS - 1);
    expect(host.callsTo('library.query')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.callsTo('library.query')).toEqual([
      { query: '%rating% GREATER 3', limit: 1, fields: ['handle'] },
    ]);
    expect(state()).toEqual({ status: 'ready', query: '%rating% GREATER 3', total: 4217 });
  });

  it('immediate 不等静默期；只差首尾空白的同一串不重问', async () => {
    const host = installFakeHost();
    host.answer('library.query', found(3));
    const { service, state } = setup(host);
    service.request(' ALL ', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toEqual({ status: 'ready', query: 'ALL', total: 3 });
    service.request('ALL');
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS);
    expect(host.callsTo('library.query')).toHaveLength(1);
  });

  it('宿主认不出（INVALID_PARAMS）写成 invalid，别的失败写成 failed，不混为一谈', async () => {
    const host = installFakeHost();
    const { service, state } = setup(host);
    host.answer('library.query', hostFailure('INVALID_PARAMS'));
    service.request('genre IS (');
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS);
    expect(state()).toEqual({ status: 'invalid', query: 'genre IS (' });
    host.answer('library.query', hostFailure('OPERATION_FAILED'));
    service.request('genre IS Jazz');
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS);
    expect(state()).toEqual({ status: 'failed', query: 'genre IS Jazz' });
  });

  it('查询又变了，在路上的旧应答作废，不能盖掉新查询的结果', async () => {
    const host = installFakeHost();
    host.answer('library.query', found(0));
    const held = host.hold('library.query');
    const { service, state } = setup(host);
    service.request('old');
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS);
    service.request('new');
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS);
    held.respond(1, found(2));
    await vi.advanceTimersByTimeAsync(0);
    held.respond(0, found(99));
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toEqual({ status: 'ready', query: 'new', total: 2 });
  });

  it('清空查询立即撤掉预览，排着的那一发不再发', async () => {
    const host = installFakeHost();
    const { service, state } = setup(host);
    service.request('ALL');
    service.request('');
    expect(state()).toEqual({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS);
    expect(host.callsTo('library.query')).toEqual([]);
  });

  it('reset 撤掉预览与排着的那一发，之后同一串能再问', async () => {
    const host = installFakeHost();
    host.answer('library.query', found(7));
    const { service, state } = setup(host);
    service.request('ALL');
    service.reset();
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS);
    expect(host.callsTo('library.query')).toEqual([]);
    expect(state()).toEqual({ status: 'idle' });
    service.request('ALL', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toEqual({ status: 'ready', query: 'ALL', total: 7 });
  });

  it('没连上宿主时不问，直接写成 failed', async () => {
    const host = installFakeHost({ available: false });
    const { service, state } = setup(host);
    service.request('ALL');
    expect(state()).toEqual({ status: 'failed', query: 'ALL' });
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS);
    expect(host.calls).toEqual([]);
  });
});
