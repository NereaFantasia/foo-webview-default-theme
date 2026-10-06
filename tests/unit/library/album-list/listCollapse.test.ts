import { describe, expect, it } from 'vitest';
import type { CollapsedSections } from '../../../../src/library/albums/collapsedSections.ts';
import {
  applyListBatch,
  applySectionBatch,
  isAlbumCollapsed,
  listCollapseOf,
  withAlbums,
  withAllAlbums,
  withoutGoneAlbums,
  withSections,
  type ListSectionKeys,
} from '../../../../src/library/album-list/listCollapse.ts';

const EMPTY: CollapsedSections = { wall: { genre: ['Rock'] } };
const SECTIONS: readonly ListSectionKeys[] = [
  { key: 'Jazz', albums: ['j1', 'j2'] },
  { key: 'Rock', albums: ['r1'] },
  { key: null, albums: ['u1'] },
];

function state(value: CollapsedSections) {
  const collapse = listCollapseOf(value, 'genre');
  return {
    sections: [...collapse.sections],
    albums: ['j1', 'j2', 'r1', 'u1'].filter((key) => isAlbumCollapsed(collapse, key)),
  };
}

describe('两层折叠', () => {
  it('节按分节依据分开记，不碰封面墙那一份；平铺档没有节', () => {
    const value = withSections(EMPTY, 'genre', ['Jazz', null], true);
    expect(value.wall).toEqual({ genre: ['Rock'] });
    expect(listCollapseOf(value, 'genre').sections).toEqual(new Set(['Jazz', null]));
    expect(listCollapseOf(value, 'folder').sections).toEqual(new Set());
    expect(withSections(value, 'album', ['x'], true)).toBe(value);
    expect(state(withSections(value, 'genre', ['Jazz'], false)).sections).toEqual([null]);
  });

  it('专辑与缺省相同就不记，不同才记进例外；缺省换了例外清空，新来的专辑随缺省', () => {
    let value = withAlbums(EMPTY, ['j1'], true);
    expect(value.listAlbums).toEqual({ collapsedByDefault: false, except: ['j1'] });
    value = withAlbums(value, ['j1'], false);
    expect(value.listAlbums).toEqual({ collapsedByDefault: false, except: [] });
    value = withAlbums(withAllAlbums(value, true), ['r1'], false);
    expect(state(value).albums).toEqual(['j1', 'j2', 'u1']);
    expect(isAlbumCollapsed(listCollapseOf(value, 'genre'), 'new')).toBe(true);
  });

  it('例外里已不在库里的专辑清掉；都还在时原样答回', () => {
    const value = withAlbums(EMPTY, ['j1', 'gone'], true);
    expect(withoutGoneAlbums(value, new Set(['j1']))?.listAlbums?.except).toEqual(['j1']);
    const kept = withAlbums(EMPTY, ['j1'], true);
    expect(withoutGoneAlbums(kept, new Set(['j1', 'j2']))).toBe(kept);
  });
});

describe('批量开合', () => {
  const start = withAlbums(withSections(EMPTY, 'genre', ['Rock'], true), ['j2'], true);

  it('页头四项：全部展开、只展开节、专辑全折叠、全部折叠', () => {
    expect(state(applyListBatch(start, 'genre', SECTIONS, 'expandAll'))).toEqual({
      sections: [],
      albums: [],
    });
    expect(state(applyListBatch(start, 'genre', SECTIONS, 'onlySections'))).toEqual({
      sections: [],
      albums: ['j1', 'j2', 'r1', 'u1'],
    });
    expect(state(applyListBatch(start, 'genre', SECTIONS, 'collapseAlbums'))).toEqual({
      sections: ['Rock'],
      albums: ['j1', 'j2', 'r1', 'u1'],
    });
    expect(state(applyListBatch(start, 'genre', SECTIONS, 'collapseAll'))).toEqual({
      sections: ['Jazz', 'Rock', null],
      albums: ['j1', 'j2', 'r1', 'u1'],
    });
  });

  it('节头菜单：展开本节全部专辑、折叠本节全部专辑、只展开本节；不认得的节不动', () => {
    const shut = withSections(start, 'genre', ['Jazz'], true);
    expect(state(applySectionBatch(shut, 'genre', SECTIONS, 'Jazz', 'expandAlbums'))).toEqual({
      sections: ['Rock'],
      albums: [],
    });
    expect(state(applySectionBatch(start, 'genre', SECTIONS, 'Jazz', 'collapseAlbums'))).toEqual({
      sections: ['Rock'],
      albums: ['j1', 'j2'],
    });
    expect(state(applySectionBatch(start, 'genre', SECTIONS, 'Rock', 'only')).sections).toEqual([
      'Jazz',
      null,
    ]);
    expect(applySectionBatch(start, 'genre', SECTIONS, 'Pop', 'only')).toBe(start);
  });
});
