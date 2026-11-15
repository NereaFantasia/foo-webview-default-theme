import { describe, expect, it } from 'vitest';
import {
  appleTextLanguage,
  readApplePage,
} from '../../../../../src/library/biography/apple/applePage.ts';

import {
  APPLE_EN_BIO as EN_BIO,
  APPLE_HLS_SQUARE as HLS_SQUARE,
  APPLE_HLS_WIDE as HLS_WIDE,
  APPLE_ID as ID,
  APPLE_LOGO as LOGO,
  APPLE_PAGE_URL as PAGE_URL,
  APPLE_THUMB as THUMB,
  appleHeader as headerOf,
  appleLinked as linkedOf,
  applePageHtml,
  type ApplePageOptions,
} from '../../../../fixtures/applePages.ts';

function page(options: ApplePageOptions = {}): string {
  return applePageHtml(options);
}

function profileOf(html: string, id = ID) {
  const result = readApplePage(html, id);
  if (result.kind !== 'found') throw new Error('page not found');
  return result.profile;
}

describe('Apple 艺人页', () => {
  it('从 JSON-LD 取名字、简介、曲风、艺术照和不含查询串的页面地址', () => {
    expect(profileOf(page())).toMatchObject({
      id: ID,
      name: 'Queen',
      url: PAGE_URL,
      paragraphs: [EN_BIO],
      textLanguage: 'en',
      genres: ['Rock'],
      image: THUMB,
    });
  });

  it('英文简介里标作品名的 <i> 标记去掉、文字留下；不是标签的尖括号原样保留', () => {
    const html = page({
      linked: linkedOf({
        description:
          'Her debut <i>Fantasy</i> sold well.\nThen <i>Capricorn</i> and <i>Yeh, Hwei-Mei</i>.\nFans <3 it, and 5 < 6.',
      }),
    });
    expect(profileOf(html).paragraphs).toEqual([
      'Her debut Fantasy sold well.',
      'Then Capricorn and Yeh, Hwei-Mei.',
      'Fans <3 it, and 5 < 6.',
    ]);
  });

  it('从页面数据取艺术字图片和两种动态艺术照，静帧用各自的', () => {
    const profile = profileOf(page());
    expect(profile.logo).toEqual({ url: LOGO, width: 2930, height: 958 });
    expect(profile.motion).toEqual({
      square: { video: HLS_SQUARE, poster: THUMB },
      wide: { video: HLS_WIDE, poster: THUMB },
    });
  });

  it('头部宽幅图：wideArtwork 给基础地址与裁切码；没有就取宽幅动态艺术照的静帧、整图不裁；都没有为空', () => {
    const base =
      'https://is1-ssl.mzstatic.com/image/thumb/Features221/v4/b9/68/a8/b968/mzl.abc.jpg';
    const wideArtwork = (cropStyle: unknown) => ({
      cropStyle,
      dictionary: { url: `${base}/{w}x{h}{c}.{f}`, width: 2401, height: 2401 },
    });
    expect(profileOf(page({ header: headerOf({ wideArtwork: wideArtwork('vf') }) })).wide).toEqual({
      url: base,
      crop: 'vf',
    });
    // 默认样本只有宽幅动态艺术照
    expect(profileOf(page()).wide).toEqual({ url: THUMB, crop: 'bb' });
    // 裁切码不合格的 wideArtwork 不要，退回静帧
    expect(profileOf(page({ header: headerOf({ wideArtwork: wideArtwork('VF1') }) })).wide).toEqual(
      {
        url: THUMB,
        crop: 'bb',
      },
    );
    const bare = { id: ID, artistLogo: null, videoArtwork: null, wideVideoArtwork: null };
    expect(profileOf(page({ header: bare })).wide).toBeNull();
    expect(profileOf(page({ serialized: '{not json' })).wide).toBeNull();
  });

  it('宽幅图带着页面给的底色：wideArtwork 用自己的，退到宽幅动态艺术照的静帧时用静帧的', () => {
    const base =
      'https://is1-ssl.mzstatic.com/image/thumb/Features221/v4/b9/68/a8/b968/mzl.abc.jpg';
    const withColor = {
      wideArtwork: {
        cropStyle: 'vf',
        dictionary: { url: `${base}/{w}x{h}{c}.{f}`, bgColor: 'e8aca7' },
      },
    };
    expect(profileOf(page({ header: headerOf(withColor) })).wide).toEqual({
      url: base,
      crop: 'vf',
      color: 'e8aca7',
    });
    const wideVideoArtwork = {
      dictionary: {
        motionArtistWide16x9: {
          video: HLS_WIDE,
          previewFrame: { url: `${THUMB}/{w}x{h}{c}.{f}`, bgColor: '050609' },
        },
      },
    };
    expect(profileOf(page({ header: headerOf({ wideVideoArtwork }) })).wide).toEqual({
      url: THUMB,
      crop: 'bb',
      color: '050609',
    });
  });

  it('页面数据坏了或头部项不是这位艺人时，媒体整块不出，简介照常', () => {
    for (const html of [
      page({ serialized: '{not json' }),
      page({ header: headerOf({ id: '999' }) }),
      page({ serialized: '{"data": []}' }),
    ]) {
      const profile = profileOf(html);
      expect(profile.paragraphs).toEqual([EN_BIO]);
      expect(profile.logo).toBeNull();
      expect(profile.motion).toBeNull();
    }
  });

  it('艺人没有艺术字图片和动态艺术照时对应字段为空', () => {
    const profile = profileOf(
      page({ header: { id: ID, artistLogo: null, videoArtwork: null, wideVideoArtwork: null } }),
    );
    expect(profile.logo).toBeNull();
    expect(profile.motion).toBeNull();
  });

  it('JSON-LD 指向别的艺人、缺失或读不出时算读不出', () => {
    expect(readApplePage(page(), '1').kind).toBe('invalid');
    expect(readApplePage(page({ linked: null }), ID).kind).toBe('invalid');
    expect(readApplePage(page({ linked: linkedOf({ name: '' }) }), ID).kind).toBe('invalid');
    expect(readApplePage('<html>{"url": "x"}</html>', ID).kind).toBe('invalid');
    expect(readApplePage(`${page()}${' '.repeat(2_000_001)}`, ID).kind).toBe('invalid');
  });

  it('简介保留换行成多段，空白、NBSP、制表符压成单空格，去掉控制字符', () => {
    const raw = 'First  line\twith   gaps\r\n\r\n  Second\u0007 line \n\n\nThird';
    expect(profileOf(page({ linked: linkedOf({ description: raw }) })).paragraphs).toEqual([
      'First line with gaps',
      'Second line',
      'Third',
    ]);
  });

  it('不足 150 字又含 Apple Music 的是占位句，不算简介；同一句放进长简介里不受影响', () => {
    const placeholder = '在 Apple Music 上畅听 MIRROR 的音乐。';
    const none = profileOf(page({ linked: linkedOf({ description: placeholder }) }));
    expect(none.paragraphs).toEqual([]);
    expect(none.textLanguage).toBeNull();
    const long = `Apple Musicに語り、${'音楽を作り続けている。'.repeat(30)}`;
    expect(profileOf(page({ linked: linkedOf({ description: long }) })).paragraphs).toEqual([long]);
  });

  it('没有简介的页面照样读出曲风和艺术照', () => {
    const profile = profileOf(page({ linked: linkedOf({ description: '' }) }));
    expect(profile.paragraphs).toEqual([]);
    expect(profile.genres).toEqual(['Rock']);
    expect(profile.image).toBe(THUMB);
  });

  it('曲风去重并限 8 条，单个字符串也认，艺术照不合格时为空', () => {
    const many = Array.from({ length: 12 }, (_, index) => `G${index % 10}`);
    expect(profileOf(page({ linked: linkedOf({ genre: many }) })).genres).toHaveLength(8);
    expect(profileOf(page({ linked: linkedOf({ genre: 'Pop' }) })).genres).toEqual(['Pop']);
    expect(
      profileOf(page({ linked: linkedOf({ image: 'https://example.com/a.png' }) })).image,
    ).toBeNull();
  });

  it('简介太长时算读不出', () => {
    const huge = 'a'.repeat(64_001);
    expect(readApplePage(page({ linked: linkedOf({ description: huge }) }), ID).kind).toBe(
      'invalid',
    );
  });
});

describe('Apple 简介的语言', () => {
  it('按文字内容判：日文原文判日文，中文里夹着片假名人名仍是中文，英文夹着汉字名仍是英文', () => {
    expect(
      appleTextLanguage('米津玄師は、ボカロPハチとして活動を始め、独自の音楽を作り続けている。'),
    ).toBe('ja');
    expect(
      appleTextLanguage(
        '宇多田ヒカL是日本创作歌手，她的首张专辑销量惊人，影响了整整一代人的音乐审美。',
      ),
    ).toBe('zh');
    expect(
      appleTextLanguage(
        'Kenshi Yonezu (米津玄師) began as a producer and became one of the biggest stars.',
      ),
    ).toBe('en');
    expect(appleTextLanguage('방탄소년단은 전 세계를 무대로 활동하는 한국의 그룹이다.')).toBe('ko');
    expect(appleTextLanguage('这是一段中文简介，介绍这位歌手的成长经历。')).toBe('zh');
  });
});
