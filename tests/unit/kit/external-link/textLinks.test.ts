import { expect, test } from 'vitest';
import { readableUrl, textLinks } from '../../../../src/kit/external-link/textLinks.ts';

test('中日文只在显示时解码，分段仍保留原文、多行和编码地址', () => {
  const display = 'http://compllege.com/post/163636653001/2017年コミックマーケット92-金曜日-東7';
  const url = encodeURI(display);
  const text = `C92\r\n${url}\n备注 %E5%B9%B4`;
  const parts = textLinks(text);
  expect(parts).toEqual([{ text: 'C92\r\n' }, { text: url, url }, { text: '\n备注 %E5%B9%B4' }]);
  expect(parts.map((part) => part.text).join('')).toBe(text);
  expect(readableUrl(url)).toBe(display);
  expect(readableUrl('备注 %E5%B9%B4')).toBe('备注 %E5%B9%B4');
});

test('保留分隔符、百分号、空格与控制字符；畸形 UTF-8 不抛错', () => {
  const suffix = '?q=%E4%B8%AD%26%2F%3F%23%25%20%0D%0A#%E6%96%87';
  expect(readableUrl(`https://example.com/${suffix}`)).toBe(
    'https://example.com/?q=中%26%2F%3F%23%25%20%0D%0A#文',
  );
  for (const encoded of ['%E2%80%AE', '%E2%80%8B', '%C2%A0', '%FF', '%E5%B9', '%XX']) {
    const value = `https://example.com/${encoded}`;
    expect(readableUrl(value)).toBe(value);
  }
  expect(readableUrl('https://%E4%BE%8B%E5%AD%90.test/%E4%B8%AD')).toBe(
    'https://xn--fsqu00a.test/中',
  );
});

test('标题链接保留文字和原始偏移，裸网址与标点分开', () => {
  const text = 'Label (https://example.com/wiki_(artist)). 后文';
  const parts = textLinks(text, [{ start: 0, end: 5, url: 'https://example.com/label' }]);
  expect(parts).toEqual([
    { text: 'Label', url: 'https://example.com/label' },
    { text: ' (' },
    { text: 'https://example.com/wiki_(artist)', url: 'https://example.com/wiki_(artist)' },
    { text: '). 后文' },
  ]);
  expect(parts.map((part) => part.text).join('')).toBe(text);
});

test('不把危险协议、带凭据的地址与非法范围变成链接', () => {
  const text = 'javascript:alert(1)\nfile:///E:/a.txt\nhttps://user:pass@example.com/\nLabel';
  expect(textLinks(text)).toEqual([{ text }]);
  expect(
    textLinks('Label', [
      { start: -1, end: 3, url: 'https://example.com/' },
      { start: 0, end: 99, url: 'https://example.com/' },
      { start: 0, end: 5, url: 'javascript:alert(1)' },
    ]),
  ).toEqual([{ text: 'Label' }]);
});
