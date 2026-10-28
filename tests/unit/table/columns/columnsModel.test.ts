import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDER,
  MIN_WIDTH,
  widthOf,
  type ColumnId,
} from '../../../../src/table/columns/columns.ts';
import { canResizeColumn } from '../../../../src/table/columns/columnsLayout.ts';
import {
  createColumnsModel,
  type ColumnsOptions,
} from '../../../../src/table/columns/columnsModel.ts';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';

const KEY = 'default-theme.album-list-columns.v1';
const LIST: ColumnId[] = ['cover', 'number', 'title', 'artist', 'rating', 'duration', 'album'];

function memory(): PrefStorage & { saved: Map<string, string> } {
  const saved = new Map<string, string>();
  return {
    saved,
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, value),
  };
}

function setup(options: { offered?: ColumnId[]; hidden?: ColumnId[] } = {}, storage = memory()) {
  const store = createStore();
  const model = createColumnsModel(store, {
    key: KEY,
    offered: options.offered ?? LIST,
    hidden: options.hidden ?? ['album'],
    storage,
  });
  const layout = () => store.get(model.layout);
  const widths = () => store.get(model.state).widths;
  return { store, model, layout, widths, storage };
}

describe('画哪些列', () => {
  it('只画这张表有的、没藏的列，按列序；曲目行不含封面', () => {
    const { model, layout } = setup();
    model.setContainerWidth(1200);
    expect(layout().header).toEqual(['cover', 'number', 'title', 'artist', 'rating', 'duration']);
    expect(layout().cells).toEqual(['number', 'title', 'artist', 'rating', 'duration']);
    expect(layout().rowTemplate).toBe('52px 280px 160px 88px 60px');
    expect(layout().headerTemplate).toBe(`120px ${layout().rowTemplate}`);
  });

  it('封面列等量到容器宽度才出现，宽度不超过容器宽的三分之一', () => {
    const { model, layout } = setup();
    expect(layout().header).not.toContain('cover');
    expect(layout().coverWidth).toBe(0);
    model.setContainerWidth(600);
    expect(layout().coverWidth).toBe(120);
    model.setContainerWidth(330);
    expect(layout().coverWidth).toBe(110);
  });

  it('存的封面宽超过容器宽的三分之一时按三分之一画', () => {
    const store = createStore();
    const model = createColumnsModel(store, {
      key: KEY,
      offered: LIST,
      widths: { cover: 300 },
      storage: memory(),
    });
    model.setContainerWidth(600);
    expect(store.get(model.layout).coverWidth).toBe(200);
  });

  it('窗口变窄仍保留勾选的列和普通列宽', () => {
    const { model, layout, widths } = setup();
    model.setContainerWidth(520);
    const before = widths();
    expect(layout().header).toEqual(['cover', 'number', 'title', 'artist', 'rating', 'duration']);
    model.setContainerWidth(521);
    expect(widths()).toEqual(before);
  });

  it('量到的宽度不是有限非负数时不收', () => {
    const { model, store } = setup();
    model.setContainerWidth(800);
    model.setContainerWidth(Number.NaN);
    model.setContainerWidth(-1);
    expect(store.get(model.state).containerWidth).toBe(800);
  });
});

describe('显隐', () => {
  it('藏一列、再勾回来，列宽不动，每次都落盘', () => {
    const { model, layout, widths, storage } = setup();
    model.setContainerWidth(1200);
    const before = widths();
    model.setHidden('artist', true);
    expect(layout().cells).not.toContain('artist');
    expect(JSON.parse(storage.saved.get(KEY) ?? '{}').hidden).toEqual(['album', 'artist']);
    model.setHidden('artist', false);
    expect(layout().cells).toContain('artist');
    expect(widths()).toEqual(before);
    expect(JSON.parse(storage.saved.get(KEY) ?? '{}').hidden).toEqual(['album']);
  });

  it('标题列与这张表没有的列藏不了', () => {
    const { model, layout, storage } = setup({ offered: ['number', 'title', 'duration'] });
    model.setHidden('title', true);
    model.setHidden('rating', true);
    expect(layout().cells).toEqual(['number', 'title', 'duration']);
    expect(storage.saved.has(KEY)).toBe(false);
  });

  it('落盘的显隐与列序在下一次打开时读回', () => {
    const storage = memory();
    const first = setup({}, storage);
    first.model.setHidden('rating', true);
    first.model.moveColumn('duration', 'number', false);
    const second = setup({}, storage);
    second.model.setContainerWidth(1200);
    expect(second.layout().header).toEqual(['cover', 'duration', 'number', 'title', 'artist']);
  });
});

describe('换列', () => {
  it('拖动换列：挪到目标前后并落盘，没动时不落盘', () => {
    const { model, layout, storage } = setup();
    model.setContainerWidth(1200);
    model.moveColumn('title', 'title', true);
    expect(storage.saved.has(KEY)).toBe(false);
    model.moveColumn('number', 'artist', true);
    expect(layout().cells.slice(0, 3)).toEqual(['title', 'artist', 'number']);
    expect(storage.saved.has(KEY)).toBe(true);
  });

  it('键盘换列越过看得见的相邻列，跳过藏着的列，到头答 false；换了就落盘', () => {
    const { model, layout, storage } = setup();
    model.setContainerWidth(1200);
    model.setHidden('rating', true);
    expect(model.moveAdjacent('artist', 1)).toBe(true);
    expect(layout().cells).toEqual(['number', 'title', 'duration', 'artist']);
    expect(JSON.parse(storage.saved.get(KEY) ?? '{}').order).toContain('artist');
    expect(model.moveAdjacent('artist', 1)).toBe(false);
    expect(model.moveAdjacent('number', -1)).toBe(false);
  });

  it('键盘换列只挪这一列，藏着的列相对顺序不动', () => {
    const { model, storage } = setup();
    model.setContainerWidth(1200);
    model.setHidden('rating', true);
    model.moveAdjacent('artist', 1);
    expect(JSON.parse(storage.saved.get(KEY) ?? '{}').order).toEqual([
      ...DEFAULT_ORDER.filter((id) => id !== 'artist'),
      'artist',
    ]);
  });

  it('窄档里换过位，放宽之后别的列还在原处', () => {
    const { model, layout } = setup();
    model.setContainerWidth(400);
    model.moveAdjacent('title', 1);
    model.setContainerWidth(1200);
    expect(layout().cells).toEqual(['number', 'artist', 'title', 'rating', 'duration']);
  });

  it('窄窗键盘换列仍在全部可见列之间进行', () => {
    const { model, layout } = setup();
    model.setContainerWidth(400);
    expect(model.moveAdjacent('title', 1)).toBe(true);
    expect(layout().cells).toEqual(['number', 'artist', 'title', 'rating', 'duration']);
  });
});

describe('拖分隔条', () => {
  const measured = new Map<ColumnId, number>([
    ['cover', 120],
    ['number', 52],
    ['title', 400],
    ['artist', 200],
    ['rating', 88],
    ['duration', 60],
  ]);

  it('普通列包括最后一列都能独立调整，控件列保持固定宽度', () => {
    const { model, layout } = setup();
    model.setContainerWidth(1200);
    expect(canResizeColumn(layout(), 'title')).toBe(true);
    expect(canResizeColumn(layout(), 'artist')).toBe(true);
    expect(canResizeColumn(layout(), 'rating')).toBe(false);
    expect(canResizeColumn(layout(), 'duration')).toBe(true);
    expect(canResizeColumn(layout(), 'cover')).toBe(true);
    expect(model.beginResize('rating', measured)).toBeNull();
  });

  it('位移只改当前列，松手才落盘', () => {
    const { model, widths, storage } = setup();
    model.setContainerWidth(1200);
    const drag = model.beginResize('title', measured);
    drag?.update(50);
    expect(widthOf(widths(), 'title')).toBe(450);
    expect(widthOf(widths(), 'artist')).toBe(160);
    expect(widthOf(widths(), 'duration')).toBe(60);
    drag?.update(-20);
    expect(widthOf(widths(), 'title')).toBe(380);
    expect(storage.saved.has(KEY)).toBe(false);
    drag?.commit();
    expect(JSON.parse(storage.saved.get(KEY) ?? '{}').widths[3]).toBe(380);
  });

  it('拖动一列不受右侧列最小宽度限制', () => {
    const { model, widths } = setup();
    model.setContainerWidth(1200);
    const drag = model.beginResize('artist', measured);
    drag?.update(20);
    expect(widthOf(widths(), 'artist')).toBe(220);
    expect(widthOf(widths(), 'rating')).toBe(88);
    expect(widthOf(widths(), 'duration')).toBe(60);
    drag?.update(500);
    expect(widthOf(widths(), 'artist')).toBe(700);
    expect(widthOf(widths(), 'duration')).toBe(60);
    model.beginResize('duration', measured)?.update(-500);
    expect(widthOf(widths(), 'duration')).toBe(MIN_WIDTH);
  });

  it('封面列只改自己，夹在 0 与容器宽的三分之一之间', () => {
    const { model, layout } = setup();
    model.setContainerWidth(900);
    const drag = model.beginResize('cover', measured);
    drag?.update(1000);
    expect(layout().coverWidth).toBe(300);
    drag?.update(-1000);
    expect(layout().coverWidth).toBe(0);
    expect(layout().header).toContain('cover');
  });

  it('取消回到按下时的列宽，不落盘', () => {
    const { model, widths, storage } = setup();
    model.setContainerWidth(1200);
    const before = widths();
    const drag = model.beginResize('title', measured);
    drag?.update(80);
    drag?.cancel();
    expect(widths()).toEqual(before);
    expect(storage.saved.has(KEY)).toBe(false);
  });
});

describe('同一个存档键', () => {
  it('两张表共用一份：改一边另一边跟着变，落盘不拿旧状态互相覆盖', () => {
    const store = createStore();
    const storage = memory();
    const options: ColumnsOptions = { key: KEY, offered: LIST, hidden: ['album'], storage };
    const first = createColumnsModel(store, options);
    const second = createColumnsModel(store, options);
    first.setHidden('artist', true);
    second.moveColumn('duration', 'number', false);
    expect(store.get(second.state).hidden.has('artist')).toBe(true);
    const saved = JSON.parse(storage.saved.get(KEY) ?? '{}');
    expect(saved.hidden).toEqual(['album', 'artist']);
    expect(saved.order.slice(2, 4)).toEqual(['duration', 'number']);
  });

  it('容器宽度各量各的', () => {
    const store = createStore();
    const options: ColumnsOptions = { key: KEY, offered: LIST, storage: memory() };
    const wide = createColumnsModel(store, options);
    const narrow = createColumnsModel(store, options);
    wide.setContainerWidth(1200);
    narrow.setContainerWidth(400);
    expect(store.get(wide.state).containerWidth).toBe(1200);
    expect(store.get(narrow.state).containerWidth).toBe(400);
  });
});

describe('窄窗与恢复缺省', () => {
  const SONGS: ColumnId[] = ['title', 'artist', 'album', 'year', 'genre', 'rating', 'duration'];

  it('各档宽度保留相同的字段', () => {
    const store = createStore();
    const model = createColumnsModel(store, {
      key: 'default-theme.songs-columns.v1',
      offered: SONGS,
      storage: memory(),
    });
    const cells = () => store.get(model.layout).cells;
    model.setContainerWidth(1000);
    expect(cells()).toEqual(['title', 'artist', 'album', 'year', 'genre', 'rating', 'duration']);
    model.setContainerWidth(860);
    expect(cells()).toEqual(SONGS);
    model.setContainerWidth(400);
    expect(cells()).toEqual(SONGS);
  });

  it('恢复缺省：列宽、显隐与列序回到建模型时的样子，并落盘', () => {
    const { store, model, storage } = setup();
    model.setContainerWidth(1200);
    model.setHidden('album', false);
    model.moveColumn('duration', 'title', false);
    model.reset();
    const state = store.get(model.state);
    expect([...state.hidden]).toEqual(['album']);
    expect(state.order.indexOf('duration')).toBeGreaterThan(state.order.indexOf('title'));
    expect(JSON.parse(storage.saved.get(KEY) ?? 'null')).toMatchObject({ hidden: ['album'] });
  });
});
