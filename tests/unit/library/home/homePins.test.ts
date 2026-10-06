import { createStore } from 'jotai/vanilla';
import { expect, it } from 'vitest';
import {
  HOME_PIN_LIMIT,
  HOME_PINS_KEY,
  parseHomePins,
  startHomePins,
} from '../../../../src/library/home/homePins.ts';

const pin = { kind: 'album', subject: 'A\0Artist', name: 'A' } as const;

it('固定入口保存对象身份，重新创建服务后恢复', () => {
  const store = createStore();
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const first = startHomePins(store, storage);
  expect(first.toggle(pin)).toBe(true);
  const next = startHomePins(store, storage);
  expect(store.get(next.state).items).toEqual([pin]);
  expect(next.toggle({ ...pin, name: 'Changed' })).toBe(true);
  expect(JSON.parse(data.get(HOME_PINS_KEY) ?? '')).toEqual([]);
});

it('拒绝重复、未知类型、空身份及超出数量上限的存档', () => {
  for (const value of [
    [pin, pin],
    [{ ...pin, kind: 'songs' }],
    [{ ...pin, subject: '' }],
    Array.from({ length: HOME_PIN_LIMIT + 1 }, (_, i) => ({ ...pin, subject: String(i) })),
  ])
    expect(parseHomePins(JSON.stringify(value))).toBeNull();
  expect(parseHomePins(null)).toEqual([]);
  expect(parseHomePins('{')).toBeNull();
});

it('读写失败不覆盖原有固定入口', () => {
  const store = createStore();
  const service = startHomePins(store, {
    getItem: () => JSON.stringify([pin]),
    setItem: () => {
      throw new Error('full');
    },
  });
  expect(service.toggle(pin)).toBe(false);
  expect(store.get(service.state)).toMatchObject({ items: [pin], saveFailed: true });
  const broken = startHomePins(store, {
    getItem: () => '{',
    setItem: () => {
      throw new Error('unexpected write');
    },
  });
  expect(broken.toggle(pin)).toBe(false);
  expect(store.get(broken.state).readFailed).toBe(true);
});
