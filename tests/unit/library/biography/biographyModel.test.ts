import { describe, expect, it } from 'vitest';
import {
  biographyArtist,
  biographyLanguage,
  BIOGRAPHY_LANGUAGES,
  biographyLicense,
  lastfmArtistFromUrl,
  lastfmBiographyUrl,
} from '../../../../src/library/biography/biographyModel.ts';

describe('简介身份', () => {
  it('支持来源的各语言路径，地区标签取主语言，未知语言回退英文', () => {
    expect(biographyLanguage('zh-Hant-TW')).toBe('zh');
    expect(biographyLanguage('ja-JP')).toBe('ja');
    expect(biographyLanguage('fr-CA')).toBe('fr');
    expect(biographyLanguage('ko-KR')).toBe('en');
    expect(biographyLanguage('bad_tag')).toBe('en');
    for (const language of BIOGRAPHY_LANGUAGES) {
      const url = new URL(lastfmBiographyUrl('Queen', language));
      expect(url.pathname).toBe(`${language === 'en' ? '' : `/${language}`}/music/Queen/+wiki`);
      expect(lastfmArtistFromUrl(url.href)).toBe('Queen');
    }
  });

  it('保留简繁区别，并排除空名字、控制字符和合辑艺术家', () => {
    expect(biographyArtist(' 赵咏华 ')).toBe('赵咏华');
    expect(biographyArtist('趙詠華')).toBe('趙詠華');
    for (const value of ['', ' ', 'Various Artists', 'VA', '群星', 'a\nb', '.', '..'])
      expect(biographyArtist(value)).toBeNull();
  });

  it('来源链接只接受 Last.fm HTTPS 艺人页，并安全编码路径', () => {
    for (const url of ['https://www.last.fm/zh/music/Queen/+wiki', 'https://last.fm/music/Queen/'])
      expect(lastfmArtistFromUrl(url)).toBe('Queen');
    expect(lastfmArtistFromUrl(lastfmBiographyUrl('AC/DC', 'zh'))).toBe('AC/DC');
    expect(lastfmArtistFromUrl('https://www.last.fm/music/David+Bowie')).toBe('David Bowie');
    expect(lastfmArtistFromUrl('https://www.last.fm/music/A%2BB')).toBe('A+B');
    expect(
      lastfmArtistFromUrl('https://www.last.fm/music/+noredirect/%E5%91%A8%E6%9D%B0%E4%BC%A6'),
    ).toBe('周杰伦');
    expect(lastfmBiographyUrl('A?B#C', 'en')).toBe('https://www.last.fm/music/A%3FB%23C/+wiki');
    for (const url of [
      'javascript:alert(1)',
      'http://www.last.fm/music/Queen',
      'https://www.last.fm.evil.test/music/Queen',
      'https://evil.test/music/Queen',
      'https://user@www.last.fm/music/Queen',
      'https://www.last.fm:4431/music/Queen',
      'https://www.last.fm/music/Queen/+albums',
      'https://www.last.fm/music/%00',
      'https://www.last.fm/music/%FF',
    ])
      expect(lastfmArtistFromUrl(url)).toBeNull();
  });

  it('许可只接受明确支持的 CC BY-SA 版本，输出固定 HTTPS 链接', () => {
    expect(biographyLicense('http://creativecommons.org/licenses/by-sa/3.0/legalcode')).toEqual({
      url: 'https://creativecommons.org/licenses/by-sa/3.0/',
      name: 'CC BY-SA 3.0',
    });
    expect(biographyLicense('https://creativecommons.org/licenses/by-sa/4.0/')).toMatchObject({
      name: 'CC BY-SA 4.0',
    });
    expect(
      biographyLicense('https://creativecommons.org.evil.test/licenses/by-sa/3.0/'),
    ).toBeNull();
    expect(biographyLicense('https://creativecommons.org/licenses/by-nc/4.0/')).toBeNull();
  });
});
