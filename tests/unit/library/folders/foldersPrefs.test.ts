import { expect, it } from 'vitest';
import { parseFoldersPrefs } from '../../../../src/library/folders/foldersPrefs.ts';
it('偏好只接收已知类型，尺寸按步长约束，损坏存档回默认值', () => {
  expect(parseFoldersPrefs('{')).toMatchObject({
    view: 'list',
    density: 'standard',
    size: 160,
    recursive: true,
  });
  expect(
    parseFoldersPrefs(
      JSON.stringify({
        view: 'covers',
        density: 'compact',
        size: 291,
        recursive: false,
        pins: [{ key: 'bad', name: '坏路径' }],
      }),
    ),
  ).toMatchObject({ view: 'covers', density: 'compact', size: 256, recursive: false, pins: [] });
  expect(parseFoldersPrefs('{"size":133}').size).toBe(136);
});
