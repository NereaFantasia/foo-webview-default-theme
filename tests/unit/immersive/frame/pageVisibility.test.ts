import { expect, test } from 'vitest';
import {
  createPageVisibility,
  type VisibilityDocument,
} from '../../../../src/immersive/frame/pageVisibility.ts';

/** 只有 `hidden` 与 `visibilitychange` 的文档替身：`set` 改隐藏态并按浏览器的样子派发事件。 */
function fakeDocument(initial = false) {
  let hidden = initial;
  const listeners = new Set<() => void>();
  const source: VisibilityDocument = {
    get hidden() {
      return hidden;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    source,
    listeners,
    set(value: boolean) {
      hidden = value;
      for (const listener of [...listeners]) listener();
    },
  };
}

test('hidden 现读文档的隐藏态；订阅随 visibilitychange 叫，退订后不再叫', () => {
  const doc = fakeDocument(true);
  const visibility = createPageVisibility(doc.source);
  expect(visibility.hidden()).toBe(true);
  const seen: boolean[] = [];
  const off = visibility.subscribe(() => seen.push(visibility.hidden()));
  doc.set(false);
  doc.set(true);
  expect(seen).toStrictEqual([false, true]);
  off();
  expect(doc.listeners.size).toBe(0);
  doc.set(false);
  expect(seen).toStrictEqual([false, true]);
  expect(visibility.hidden()).toBe(false);
});

test('没有文档（node）：一直算可见，订阅什么也不做', () => {
  const visibility = createPageVisibility(null);
  expect(visibility.hidden()).toBe(false);
  const off = visibility.subscribe(() => {
    throw new Error('不该被叫');
  });
  off();
  expect(createPageVisibility().hidden()).toBe(false);
});
