import { describe, expect, it } from 'vitest';
import {
  biographyTextParts,
  matchBiographyLinks,
  readBiographyLinks,
} from '../../../../../src/library/biography/article/biographyLinks.ts';

describe('简介正文链接', () => {
  it('标题链接按原文顺序对回文字，普通 URL 也可点击，末尾标点不进入地址', () => {
    const paragraphs = ['由 Label 发行。详情 https://example.com/wiki_(artist)。'];
    const links = matchBiographyLinks(
      paragraphs,
      [{ label: 'Label', url: '/label' }],
      'https://last.fm/',
    );
    expect(links).toEqual([{ paragraph: 0, start: 2, end: 7, url: 'https://last.fm/label' }]);
    const parts = biographyTextParts(paragraphs[0] ?? '', links);
    expect(parts.filter((part) => part.url).map((part) => part.url)).toEqual([
      'https://last.fm/label',
      'https://example.com/wiki_(artist)',
    ]);
    expect(parts.map((part) => part.text).join('')).toBe(paragraphs[0]);
  });
  it('缓存里的越界、重叠和危险链接丢掉，正文仍然可以读', () => {
    const valid = { paragraph: 0, start: 0, end: 5, url: 'https://example.com/' };
    expect(
      readBiographyLinks(
        [
          valid,
          { ...valid, start: 2 },
          { ...valid, end: 999 },
          { ...valid, paragraph: 2 },
          { ...valid, url: 'javascript:alert(1)' },
        ],
        ['Label text'],
      ),
    ).toEqual([valid]);
    expect(biographyTextParts('javascript:alert(1)', [])).toEqual([
      { text: 'javascript:alert(1)' },
    ]);
  });
});
