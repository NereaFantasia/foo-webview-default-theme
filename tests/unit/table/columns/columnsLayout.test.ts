import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER, DEFAULT_WIDTHS } from '../../../../src/table/columns/columns.ts';
import {
  columnsLayout,
  resizePartner,
  type ColumnsState,
} from '../../../../src/table/columns/columnsLayout.ts';

const STATE: ColumnsState = {
  widths: DEFAULT_WIDTHS,
  hidden: new Set(['album']),
  order: DEFAULT_ORDER,
  containerWidth: 1200,
};

describe('列的版式', () => {
  it('这张表没有封面列时，封面列没有分隔条', () => {
    const layout = columnsLayout(STATE, ['number', 'title', 'artist', 'duration']);
    expect(layout.header).not.toContain('cover');
    expect(resizePartner(layout, 'cover')).toBeNull();
  });

  it('封面列藏起来或窄档时也不画、没有分隔条', () => {
    const offered = [...DEFAULT_ORDER];
    const hidden = columnsLayout({ ...STATE, hidden: new Set(['cover']) }, offered);
    expect(resizePartner(hidden, 'cover')).toBeNull();
    const narrow = columnsLayout({ ...STATE, containerWidth: 500 }, offered);
    expect(narrow.coverWidth).toBe(0);
    expect(resizePartner(narrow, 'cover')).toBeNull();
  });

  it('藏着的列没有分隔条', () => {
    const layout = columnsLayout(STATE, [...DEFAULT_ORDER]);
    expect(resizePartner(layout, 'album')).toBeNull();
  });
});
