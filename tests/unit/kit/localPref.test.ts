import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it } from 'vitest';
import {
  browserStorage,
  choiceCodec,
  defineLocalPref,
  installPrefStorage,
  ON_OFF,
  recordOf,
  storedRecord,
  type PrefStorage,
} from '../../../src/kit/localPref.ts';

const KEY = 'default-theme.sample.v2';
const SIZES = ['small', 'large'] as const;
type Size = (typeof SIZES)[number];

const parseSize = (raw: string): Size | undefined => SIZES.find((size) => size === raw);

function samplePref() {
  return defineLocalPref<Size>({
    key: KEY,
    fallback: 'small',
    parse: parseSize,
    format: (size) => size,
  });
}

function memory(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const writes: string[] = [];
  const storage: PrefStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      map.set(key, value);
    },
  };
  return { storage, map, writes };
}

const denied: PrefStorage = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

afterEach(() => installPrefStorage(null));

describe('读存档', () => {
  it('没有存档、没有存储、读抛错、认不出都按缺省；认得出原样读回', () => {
    const pref = samplePref();
    expect(pref.read(memory().storage)).toBe('small');
    expect(pref.read(null)).toBe('small');
    expect(pref.read(denied)).toBe('small');
    expect(pref.read(memory({ [KEY]: 'huge' }).storage)).toBe('small');
    expect(pref.read(memory({ [KEY]: '' }).storage)).toBe('small');
    expect(pref.read(memory({ [KEY]: 'large' }).storage)).toBe('large');
  });

  it('读法本身抛错也按缺省', () => {
    const pref = defineLocalPref<number>({
      key: KEY,
      fallback: 1,
      parse: () => {
        throw new Error('bug');
      },
      format: String,
    });
    expect(pref.read(memory({ [KEY]: '2' }).storage)).toBe(1);
  });

  it('不给存储时用装上的页面偏好存储，还没装上时按缺省', () => {
    const pref = samplePref();
    expect(pref.read()).toBe('small');
    installPrefStorage(memory({ [KEY]: 'large' }).storage);
    expect(pref.read()).toBe('large');
  });
});

describe('store 里的值', () => {
  it('load 之前是缺省；load 读进 store 并答读到的值，各 store 各一份', () => {
    const pref = samplePref();
    const store = createStore();
    const other = createStore();
    expect(store.get(pref.atom)).toBe('small');
    expect(pref.load(store, memory({ [KEY]: 'large' }).storage)).toBe('large');
    expect(store.get(pref.atom)).toBe('large');
    expect(other.get(pref.atom)).toBe('small');
  });

  it('set 改值并写回，答改了；与此刻相同不写，答没改', () => {
    const pref = samplePref();
    const { storage, map, writes } = memory();
    const store = createStore();
    pref.load(store, storage);
    expect(pref.set(store, 'small', storage)).toBe(false);
    expect(writes).toStrictEqual([]);
    expect(pref.set(store, 'large', storage)).toBe(true);
    expect(store.get(pref.atom)).toBe('large');
    expect(map.get(KEY)).toBe('large');
    expect(pref.set(store, 'large', storage)).toBe(false);
    expect(writes).toStrictEqual([KEY]);
  });

  it('对象形的值每次给新对象都算改了，照写', () => {
    const pref = defineLocalPref({
      key: KEY,
      fallback: { open: true },
      parse: (raw) => ({ open: storedRecord(raw)['open'] !== false }),
      format: JSON.stringify,
    });
    const { storage, map, writes } = memory();
    const store = createStore();
    pref.set(store, { open: false }, storage);
    pref.set(store, { open: false }, storage);
    expect(writes).toHaveLength(2);
    expect(pref.read(storage)).toStrictEqual({ open: false });
    expect(map.get(KEY)).toBe('{"open":false}');
  });

  it('写不进或没有存储时这一次照样生效，不抛', () => {
    const pref = samplePref();
    const store = createStore();
    expect(pref.set(store, 'large', denied)).toBe(true);
    expect(store.get(pref.atom)).toBe('large');
    const detached = createStore();
    expect(pref.set(detached, 'large', null)).toBe(true);
    expect(detached.get(pref.atom)).toBe('large');
  });

  it('write 只写存档，不动 store', () => {
    const pref = samplePref();
    const { storage, map } = memory();
    const store = createStore();
    pref.write('large', storage);
    expect(map.get(KEY)).toBe('large');
    expect(store.get(pref.atom)).toBe('small');
    expect(() => pref.write('large', denied)).not.toThrow();
  });
});

describe('对象形存档的读法', () => {
  it('不是 JSON、不是对象、数组与 null 都读成空对象', () => {
    for (const raw of [null, '', '{', '42', '"text"', '[]', 'null']) {
      expect(storedRecord(raw), String(raw)).toStrictEqual({});
    }
    expect(storedRecord('{"a":1}')).toStrictEqual({ a: 1 });
    expect(recordOf([1])).toStrictEqual({});
    expect(recordOf({ b: true })).toStrictEqual({ b: true });
  });
});

describe('取值的写法', () => {
  it('开关只认 on / off，写回同样的文本', () => {
    expect([
      ON_OFF.parse('on'),
      ON_OFF.parse('off'),
      ON_OFF.parse('true'),
      ON_OFF.parse(''),
    ]).toEqual([true, false, undefined, undefined]);
    expect([ON_OFF.format(true), ON_OFF.format(false)]).toEqual(['on', 'off']);
  });

  it('取值表按文本认，数字表也一样；不在表里的认不出', () => {
    const sizes = choiceCodec(SIZES);
    expect([sizes.parse('large'), sizes.parse('Large'), sizes.parse('')]).toEqual([
      'large',
      undefined,
      undefined,
    ]);
    const caps = choiceCodec([0, 60, 120] as const);
    expect([caps.parse('60'), caps.parse('61'), caps.parse('060')]).toEqual([
      60,
      undefined,
      undefined,
    ]);
    expect(caps.format(120)).toBe('120');
  });
});

describe('browserStorage', () => {
  it('只给装上的页面偏好存储，不交出原始的 localStorage；装回 null 后为 null', () => {
    const { storage } = memory();
    Reflect.set(globalThis, 'localStorage', memory().storage);
    try {
      expect(browserStorage()).toBeNull();
      installPrefStorage(storage);
      expect(browserStorage()).toBe(storage);
      installPrefStorage(null);
      expect(browserStorage()).toBeNull();
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
