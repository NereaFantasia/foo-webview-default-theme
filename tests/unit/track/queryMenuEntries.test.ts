import { expect, it } from 'vitest';
import { queryMenuEntries, stepEntry } from '../../../src/track/queryMenuEntries.ts';

it('菜单始终列出预设与写法，连接词和播放统计按能力禁用', () => {
  const entries = queryMenuEntries({ playcount: false, connectable: false });
  expect(entries).toHaveLength(15);
  expect(
    entries.find((entry) => entry.kind === 'preset' && entry.preset.id === 'neverPlayed'),
  ).toMatchObject({ disabled: true });
  expect(
    entries.find((entry) => entry.kind === 'snippet' && entry.snippet.id === 'and'),
  ).toMatchObject({ disabled: true });
  expect(
    entries.find((entry) => entry.kind === 'snippet' && entry.snippet.id === 'format'),
  ).toMatchObject({ disabled: false });
  const ready = queryMenuEntries({ playcount: true, connectable: true });
  expect(ready.every((entry) => !entry.disabled)).toBe(true);
  expect(stepEntry(entries, -1, 1)).toBe(0);
  expect(stepEntry(entries, 1, 1)).toBe(6);
});
