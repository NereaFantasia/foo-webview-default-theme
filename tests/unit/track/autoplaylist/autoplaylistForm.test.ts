import { describe, expect, it } from 'vitest';
import {
  autoplaylistInitial,
  canCreate,
  conditionOf,
  previewLineOf,
} from '../../../../src/track/autoplaylist/autoplaylistForm.ts';
import type { AutoplaylistPreview } from '../../../../src/track/autoplaylist/autoplaylistPreview.ts';

const IDLE: AutoplaylistPreview = { status: 'idle' };

describe('autoplaylistInitial', () => {
  it('升序照原样预填：查询与排序各归各的，保持排序默认关', () => {
    expect(
      autoplaylistInitial('歌曲', { query: 'ALL', sort: '%title%', descending: false }),
    ).toEqual({ name: '歌曲', query: 'ALL', sort: '%title%', keepSorted: false });
  });

  it('降序写进查询末尾的 SORT DESCENDING BY，独立的排序留空：非空的排序会盖过查询里的', () => {
    expect(
      autoplaylistInitial('歌曲', {
        query: 'genre IS Jazz',
        sort: '%artist% | %album%',
        descending: true,
      }),
    ).toEqual({
      name: '歌曲',
      query: 'genre IS Jazz SORT DESCENDING BY %artist% | %album%',
      sort: '',
      keepSorted: false,
    });
  });

  it('没有排序串时降序无从谈起：照原样，不凭空写排序子句', () => {
    expect(autoplaylistInitial('歌曲', { query: 'ALL', sort: '', descending: true })).toEqual({
      name: '歌曲',
      query: 'ALL',
      sort: '',
      keepSorted: false,
    });
  });
});

describe('conditionOf', () => {
  it('去掉末尾的排序子句与首尾空白：library.query 不收排序，数命中数只交条件部分', () => {
    expect(conditionOf(' genre IS Jazz SORT DESCENDING BY %title% ')).toBe('genre IS Jazz');
    expect(conditionOf('ALL')).toBe('ALL');
  });
});

describe('previewLineOf', () => {
  it('查询空白，或只剩排序子句没有条件时，预览条不写东西', () => {
    expect(previewLineOf('  ', '', IDLE)).toEqual({ kind: 'none' });
    expect(previewLineOf('SORT BY %title%', '', IDLE)).toEqual({ kind: 'none' });
  });

  it('宿主数出了这一串的命中数就写命中数，本地诊断再挑剔也不拦', () => {
    // 括号没闭合，本地诊断会报错；宿主认了就以宿主为准
    const preview: AutoplaylistPreview = { status: 'ready', query: '(genre IS Jazz', total: 12 };
    expect(previewLineOf('(genre IS Jazz', '', preview)).toEqual({ kind: 'count', total: 12 });
  });

  it('查询里带排序子句：对的是条件部分的结果，命中数照写', () => {
    const preview: AutoplaylistPreview = { status: 'ready', query: 'ALL', total: 8 };
    expect(previewLineOf('ALL SORT DESCENDING BY %title%', '', preview)).toEqual({
      kind: 'count',
      total: 8,
    });
  });

  it('宿主的结果对应的不是框里这一串：还在统计，不能把旧数字写给新查询', () => {
    const preview: AutoplaylistPreview = { status: 'ready', query: 'ALL', total: 100 };
    expect(previewLineOf('genre IS Jazz', '', preview)).toEqual({ kind: 'counting' });
    expect(
      previewLineOf('genre IS Jazz', '', { status: 'pending', query: 'genre IS Jazz' }),
    ).toEqual({ kind: 'counting' });
  });

  it('宿主还没确认时本地诊断指得出错在哪就写那一处', () => {
    const line = previewLineOf('(genre IS Jazz', '', {
      status: 'pending',
      query: '(genre IS Jazz',
    });
    expect(line).toMatchObject({ kind: 'issue', issue: { code: 'unclosedParen' } });
  });

  it('宿主认不出而本地诊断没发现问题：写查询有误；没数成写没数成', () => {
    expect(previewLineOf('foo IS bar', '', { status: 'invalid', query: 'foo IS bar' })).toEqual({
      kind: 'invalid',
    });
    expect(previewLineOf('foo IS bar', '', { status: 'failed', query: 'foo IS bar' })).toEqual({
      kind: 'failed',
    });
  });

  it('查询里带了排序子句、排序框又不空：宿主以排序框为准，写排序冲突，命中数再对也不放行', () => {
    const preview: AutoplaylistPreview = { status: 'ready', query: 'ALL', total: 8 };
    expect(previewLineOf('ALL SORT DESCENDING BY %title%', '%path%', preview)).toEqual({
      kind: 'sortConflict',
    });
    // 排序框有内容但查询里没有排序子句：不冲突
    expect(previewLineOf('ALL', '%path%', preview)).toEqual({ kind: 'count', total: 8 });
  });
});

describe('canCreate', () => {
  it('名称不空且宿主已数出命中数才能创建；零命中也能', () => {
    expect(canCreate('歌曲', { kind: 'count', total: 0 })).toBe(true);
    expect(canCreate('   ', { kind: 'count', total: 5 })).toBe(false);
    // 编辑没有名称：给 null 就不查名称，只看命中数
    expect(canCreate(null, { kind: 'count', total: 5 })).toBe(true);
    expect(canCreate(null, { kind: 'counting' })).toBe(false);
    for (const kind of ['none', 'counting', 'invalid', 'failed', 'sortConflict'] as const) {
      expect(canCreate('歌曲', { kind })).toBe(false);
    }
  });
});
