import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { createDataWriter, DATA_GENERATION_PREFIX } from '../../../../src/kit/dataWrite.ts';
import {
  COLUMN_PREFS,
  migrateColumnPreferences,
} from '../../../../src/table/columns/columnMigration.ts';
import { createColumnsModel } from '../../../../src/table/columns/columnsModel.ts';
import {
  DEFAULT_ORDER,
  DEFAULT_WIDTHS,
  EXTENDED_INTRODUCED,
  widthOf,
} from '../../../../src/table/columns/columns.ts';

const { key: KEY, previousKey: OLD } = COLUMN_PREFS.albumList;
const LEGACY = JSON.stringify({
  widths: [120, 24, 52, 2, 1, 88, 60, 1, 1, 52, 96, 96, 60, 96, 64, 72, 2, 48, 96, 56, 96],
  hidden: ['album'],
  order: DEFAULT_ORDER,
});

function memory(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
  };
  const writer = createDataWriter({ storage, locks: navigator.locks, now: () => 100 });
  const prefs = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  return { values, writer, prefs };
}

describe('列偏好迁移', () => {
  it('迁移保留旧项数，首次打开页面时收起原先未提供的扩展列', async () => {
    const legacy = JSON.stringify({
      ...JSON.parse(LEGACY),
      widths: JSON.parse(LEGACY).widths.slice(0, 18),
      hidden: [],
    });
    const { writer, prefs } = memory({ [OLD]: legacy });
    await migrateColumnPreferences(writer);
    const store = createStore();
    const model = createColumnsModel(store, {
      ...COLUMN_PREFS.albumList,
      storage: prefs,
      offered: ['title', 'artist', 'genre'],
      introduced: EXTENDED_INTRODUCED,
    });
    expect(store.get(model.layout).cells).toEqual(['title', 'artist']);
    model.setContainerWidth(900);
    model.setHidden('genre', false);
    const nextStore = createStore();
    const next = createColumnsModel(nextStore, {
      ...COLUMN_PREFS.albumList,
      storage: prefs,
      offered: ['title', 'artist', 'genre'],
      introduced: EXTENDED_INTRODUCED,
    });
    expect(nextStore.get(next.layout).cells).toContain('genre');
  });

  it('旧权重按首次容器宽度换算，之后缩窗、重开与改宽都不挤压其他列，旧键保留', async () => {
    const { values, writer, prefs } = memory({ [OLD]: LEGACY });
    expect((await migrateColumnPreferences(writer)).success).toBe(true);
    const store = createStore();
    const options = {
      ...COLUMN_PREFS.albumList,
      offered: ['title', 'artist', 'duration'] as const,
      storage: prefs,
    };
    const model = createColumnsModel(store, options);
    model.setContainerWidth(660);
    expect(widthOf(store.get(model.state).widths, 'title')).toBe(400);
    expect(widthOf(store.get(model.state).widths, 'artist')).toBe(200);
    model.setContainerWidth(300);
    expect(widthOf(store.get(model.state).widths, 'title')).toBe(400);
    const drag = model.beginResize('title', new Map());
    drag?.update(80);
    drag?.commit();
    expect(widthOf(store.get(model.state).widths, 'artist')).toBe(200);
    const nextStore = createStore();
    const reopened = createColumnsModel(nextStore, options);
    reopened.setContainerWidth(1000);
    expect(widthOf(nextStore.get(reopened.state).widths, 'title')).toBe(480);
    expect(values.get(OLD)).toBe(LEGACY);
    expect(JSON.parse(values.get(KEY) ?? '{}')).not.toHaveProperty('legacyWeights');
  });

  it('回滚后旧格式写入更新，按代数选旧值；当前格式同代数时优先', async () => {
    const current = JSON.stringify({
      unit: 'px',
      widths: DEFAULT_WIDTHS,
      hidden: ['rating'],
      order: DEFAULT_ORDER,
    });
    const { values, writer } = memory({
      [OLD]: LEGACY,
      [KEY]: current,
      [`${DATA_GENERATION_PREFIX}${OLD}`]: '20',
      [`${DATA_GENERATION_PREFIX}${KEY}`]: '10',
    });
    await migrateColumnPreferences(writer);
    expect(JSON.parse(values.get(KEY) ?? '{}').hidden).toEqual(['album']);
    expect(JSON.parse(values.get(KEY) ?? '{}').legacyWeights.title).toBe(2);
    const migrated = values.get(KEY);
    values.set(
      `${DATA_GENERATION_PREFIX}${OLD}`,
      values.get(`${DATA_GENERATION_PREFIX}${KEY}`) ?? '0',
    );
    values.set(OLD, current);
    await migrateColumnPreferences(writer);
    expect(values.get(KEY)).toBe(migrated);
  });

  it('旧格式较新的清除不会从原值恢复，已有的新格式清除也不回读旧键', async () => {
    const { values, writer, prefs } = memory({
      [KEY]: LEGACY,
      [`${DATA_GENERATION_PREFIX}${OLD}`]: '20',
      [`${DATA_GENERATION_PREFIX}${KEY}`]: '10',
    });
    await migrateColumnPreferences(writer);
    expect(values.has(KEY)).toBe(false);
    values.set(OLD, LEGACY);
    await migrateColumnPreferences(writer);
    expect(values.has(KEY)).toBe(false);
    const store = createStore();
    const model = createColumnsModel(store, {
      ...COLUMN_PREFS.albumList,
      offered: ['title'],
      storage: prefs,
    });
    model.setContainerWidth(900);
    expect(widthOf(store.get(model.state).widths, 'title')).toBe(280);
  });

  it('旧格式不认识的字段继承当前像素宽度、显隐与位置', async () => {
    const current = JSON.stringify({
      unit: 'px',
      widths: DEFAULT_WIDTHS.map((width, at) => (at === 16 ? 700 : width)),
      hidden: [],
      order: DEFAULT_ORDER,
    });
    const previous = JSON.stringify({
      widths: [120, 24, 52, 2, 1, 88, 60],
      hidden: [],
      order: DEFAULT_ORDER.slice(0, 7),
    });
    const { values, writer } = memory({
      [KEY]: current,
      [OLD]: previous,
      [`${DATA_GENERATION_PREFIX}${OLD}`]: '20',
      [`${DATA_GENERATION_PREFIX}${KEY}`]: '10',
    });
    await migrateColumnPreferences(writer);
    const migrated = JSON.parse(values.get(KEY) ?? '{}');
    expect(migrated.widths[16]).toBe(700);
    expect(migrated.hidden).not.toContain('path');
    expect(migrated.order).toEqual(DEFAULT_ORDER);
  });
});
