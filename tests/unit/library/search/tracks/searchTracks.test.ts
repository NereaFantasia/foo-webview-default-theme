import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { TRACK_LIMIT } from '../../../../../src/library/libraryTracks.ts';
import { searchQuery } from '../../../../../src/library/search/searchQuery.ts';
import {
  cycleSearchSort,
  startSearchTracks,
} from '../../../../../src/library/search/tracks/searchTracks.ts';
import { presetOf } from '../../../../../src/track/queryPresets.ts';
import { trackSortPattern } from '../../../../../src/track/trackSort.ts';
import { stringParam } from '../../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

function setup(text = 'Nujabes') {
  const host = installFakeHost();
  host.answer('library.query', (params) => {
    // 带了筛选的查询只命中一首，便于分开命中与表格
    const narrowed = (stringParam(params, 'query') ?? '').includes(') AND (');
    const handles = narrowed ? ['b'] : ['a', 'b', 'c'];
    return {
      success: true,
      tracks: handles.map((handle, index) => ({ index, handle })),
      total: handles.length,
    };
  });
  const store = createStore();
  const service = startSearchTracks(store, text, host.fb);
  onTestFinished(() => service.dispose());
  return {
    host,
    service,
    matches: () => store.get(service.matches),
    rows: () => store.get(service.rows),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('列头三态', () => {
  it('换到一列按它的缺省方向，同一列再点反向，第三下回到相关度', () => {
    const title = cycleSearchSort(null, 'title');
    expect(title).toEqual({ column: 'title', descending: false });
    const reversed = cycleSearchSort(title, 'title');
    expect(reversed).toEqual({ column: 'title', descending: true });
    expect(cycleSearchSort(reversed, 'title')).toBeNull();
    // 年份从新的在前起
    const year = cycleSearchSort(reversed, 'year');
    expect(year).toEqual({ column: 'year', descending: true });
    expect(cycleSearchSort(cycleSearchSort(year, 'year'), 'year')).toBeNull();
  });
});

describe('曲目一类的取数', () => {
  it('没人要时不取；要了以后命中与表格各取一份 handle，缺省按相关度', async () => {
    const { host, service, rows } = setup();
    await flush();
    expect(host.callsTo('library.query')).toEqual([]);
    service.acquire();
    await vi.waitFor(() => expect(rows().status).toBe('ready'));
    const compiled = searchQuery('Nujabes');
    const call = { query: compiled?.query, sort: compiled?.sort, limit: TRACK_LIMIT };
    expect(host.callsTo('library.query')).toEqual([
      { ...call, fields: ['handle'] },
      { ...call, fields: ['handle'] },
    ]);
    expect(rows().handles).toEqual(['a', 'b', 'c']);
  });

  it('筛选只收窄表格，命中照旧；分面与预设与搜索词 AND', async () => {
    const { host, service, matches, rows } = setup();
    service.acquire();
    await vi.waitFor(() => expect(rows().status).toBe('ready'));
    service.filter.togglePreset('lossless');
    await vi.waitFor(() => expect(rows().handles).toEqual(['b']));
    expect(matches().handles).toEqual(['a', 'b', 'c']);
    const compiled = searchQuery('Nujabes');
    expect(host.callsTo('library.query').at(-1)).toMatchObject({
      query: `(${compiled?.query}) AND (${presetOf('lossless').query})`,
      sort: compiled?.sort,
    });
  });

  it('按列排序换成那一列的排序串，降序反过来；回到相关度用回相关度', async () => {
    const { host, service, rows } = setup();
    service.acquire();
    await vi.waitFor(() => expect(rows().status).toBe('ready'));
    service.setSort({ column: 'year', descending: true });
    await vi.waitFor(() => expect(rows().answered?.sort).toBe(trackSortPattern('year')));
    expect(rows().handles).toEqual(['c', 'b', 'a']);
    service.setSort(null);
    await vi.waitFor(() => expect(rows().answered?.sort).toBe(searchQuery('Nujabes')?.sort));
    expect(host.callsTo('library.query').length).toBeGreaterThanOrEqual(3);
  });

  it('换字段范围后命中与表格都按那个字段重取', async () => {
    const { host, service, rows } = setup();
    service.acquire();
    await vi.waitFor(() => expect(rows().status).toBe('ready'));
    service.setScope('title');
    await vi.waitFor(() =>
      expect(
        host.callsTo('library.query').filter((call) => call.query === 'title HAS "nujabes"'),
      ).toHaveLength(2),
    );
  });
});
