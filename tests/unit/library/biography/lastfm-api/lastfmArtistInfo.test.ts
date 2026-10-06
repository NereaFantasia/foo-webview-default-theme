import { describe, expect, it } from 'vitest';
import { readBiographyDetails } from '../../../../../src/library/biography/details/biographyDetailsModel.ts';
import { readLastfmArtistInfo } from '../../../../../src/library/biography/lastfm-api/lastfmArtistInfo.ts';
import { artistInfoSample } from '../../../../fixtures/lastfmApiSamples.ts';

describe('Last.fm artist.getInfo 转换', () => {
  it('正文去掉来源尾句，保留安全链接位置，换行分段并记录许可', () => {
    const info = readLastfmArtistInfo(artistInfoSample(), 'Nujabes', 'zh');
    expect(info?.document).toEqual({
      artist: 'Nujabes',
      language: 'zh',
      paragraphs: ['瀬葉淳是日本的唱片制作人。', '他创办了 Hydeout Productions。'],
      links: [{ paragraph: 1, start: 5, end: 24, url: 'https://www.last.fm/label/Hydeout' }],
      url: 'https://www.last.fm/zh/music/Nujabes/+wiki',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
      license: 'CC BY-SA 3.0',
    });
  });

  it('标签去重并去掉艺人自己的名字；计数带种类；相似艺人的链接要对得上名字', () => {
    const info = readLastfmArtistInfo(artistInfoSample(), 'Nujabes', 'ja');
    expect(info?.details).toEqual({
      tags: ['Hip-Hop', 'Jazz Rap'],
      counters: [
        { kind: 'listeners', label: 'Listeners', value: 846123 },
        { kind: 'plays', label: 'Scrobbles', value: 51200345 },
      ],
      similar: [
        { artist: 'Uyama Hiroto', url: 'https://www.last.fm/ja/music/Uyama%20Hiroto' },
        { artist: 'Fat Jon', url: 'https://www.last.fm/ja/music/Fat%20Jon' },
      ],
    });
  });

  it('只有一项时 JSON 里是对象；正文为空时没有 document；艺人对不上时整份不用', () => {
    const sample = artistInfoSample('Nujabes', '');
    Reflect.set(sample.artist.tags, 'tag', { name: 'Chillhop', url: 'https://www.last.fm/tag/x' });
    const info = readLastfmArtistInfo(sample, 'Nujabes', 'en');
    expect(info?.document).toBeNull();
    expect(info?.details.tags).toEqual(['Chillhop']);
    expect(readLastfmArtistInfo(artistInfoSample('Nujabes'), 'Fat Jon', 'en')).toBeNull();
    for (const bad of [null, {}, { artist: [] }, { artist: { url: 3 } }])
      expect(readLastfmArtistInfo(bad, 'Nujabes', 'en')).toBeNull();
  });

  it('标签与脚本只留文字，实体解开，控制字符所在的行丢掉', () => {
    const info = readLastfmArtistInfo(
      artistInfoSample(
        'Nujabes',
        '第一段<img src=x onerror="alert(1)"><script>alert(2)</script>\nA &amp; B &#x4e2d;&#25991;&nbsp;&bogus;\n第二\u0007段',
      ),
      'Nujabes',
      'en',
    );
    expect(info?.document?.paragraphs).toEqual(['第一段', 'A & B 中文 &bogus;']);
  });

  it('缓存读回保留计数的种类，不认识的种类丢掉种类、保留数字', () => {
    const now = Date.now();
    const details = readBiographyDetails(
      {
        artist: 'Nujabes',
        language: 'en',
        url: 'https://www.last.fm/music/Nujabes',
        fetchedAt: now - 1000,
        expiresAt: now + 1000,
        tags: [],
        counters: [
          { kind: 'listeners', label: 'Listeners', value: 1 },
          { kind: 'fans', label: 'Fans', value: 2 },
        ],
        similar: [],
      },
      'Nujabes',
      'en',
      now,
    );
    expect(details?.counters).toEqual([
      { kind: 'listeners', label: 'Listeners', value: 1 },
      { label: 'Fans', value: 2 },
    ]);
  });

  it('照真实应答：链到 +noredirect 的条目照样认，名字带「+」的相似艺人链接编码了两次也认', () => {
    const sample = artistInfoSample('周杰伦', '【个人资料】');
    Reflect.set(
      sample.artist,
      'url',
      'https://www.last.fm/music/+noredirect/%E5%91%A8%E6%9D%B0%E4%BC%A6',
    );
    Reflect.set(sample.artist.similar, 'artist', [
      { name: 'Queen + Paul Rodgers', url: 'https://www.last.fm/music/Queen+%252B+Paul+Rodgers' },
      {
        name: 'Freddie Mercury & Montserrat Caballé',
        url: 'https://www.last.fm/music/Freddie+Mercury+&+Montserrat+Caball%C3%A9',
      },
    ]);
    const info = readLastfmArtistInfo(sample, '周杰伦', 'zh');
    expect(info?.document?.paragraphs).toEqual(['【个人资料】']);
    expect(info?.details.similar.map((item) => item.artist)).toEqual([
      'Queen + Paul Rodgers',
      'Freddie Mercury & Montserrat Caballé',
    ]);
  });
});
