import { describe, expect, it } from 'vitest';
import {
  appleAttribution,
  lastfmInput,
  type ApplePhoto,
  type BiographyDocument,
  type BiographyInput,
  type BiographyPhoto,
} from '../../../../../src/library/biography/biographyModel.ts';
import type { BiographyDetails } from '../../../../../src/library/biography/details/biographyDetailsModel.ts';
import {
  cachedApplePhoto,
  onlinePhotoOf,
} from '../../../../../src/library/biography/online/onlinePhotoSource.ts';
import { TAISHI_PHOTO } from '../../../../fixtures/biographyPhotoSamples.ts';

const PAGE = 'https://music.apple.com/cn/artist/queen/3296287';
const PHOTO: ApplePhoto = {
  source: 'apple',
  url: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/cc/queen',
  pageUrl: PAGE,
};

/** 搜索结果里的名字（皇后乐队）与页面里的名字（Queen）常不一样，认人靠 ID */
const appleInput = (id: string | null): BiographyInput => ({
  artist: 'Queen',
  source: 'apple',
  sourceId: id,
  sourceArtist: '皇后乐队',
  language: 'en',
});

function appleDocument(id: string, photo?: ApplePhoto): BiographyDocument {
  return {
    source: 'apple',
    sourceId: id,
    artist: 'Queen',
    language: 'en',
    paragraphs: ['x'],
    url: PAGE,
    attribution: appleAttribution(PAGE),
    ...(photo ? { photo } : {}),
  };
}

function appleDetails(url: string, photo?: ApplePhoto): BiographyDetails {
  return {
    source: 'apple',
    artist: 'Queen',
    language: 'en',
    url,
    fetchedAt: 1,
    expiresAt: 2,
    tags: [],
    counters: [],
    similar: [],
    ...(photo ? { photo } : {}),
  };
}

describe('简介里带的主图', () => {
  it('Apple：按艺人 ID 核对，页面里的名字与搜索结果的名字不同也认', () => {
    expect(
      onlinePhotoOf(appleInput('3296287'), { document: appleDocument('3296287', PHOTO) }),
    ).toEqual(PHOTO);
  });

  it('Apple：取数服务的状态还停在上一位艺人上时不用它的图', () => {
    expect(
      onlinePhotoOf(appleInput('3296287'), { document: appleDocument('111', PHOTO) }),
    ).toBeNull();
    expect(
      onlinePhotoOf(appleInput('3296287'), {
        details: appleDetails('https://music.apple.com/cn/artist/someone/111', PHOTO),
      }),
    ).toBeNull();
  });

  it('Apple：没有正文只有附加资料时，附加资料里的图按页面地址里的艺人 ID 核对', () => {
    expect(onlinePhotoOf(appleInput('3296287'), { details: appleDetails(PAGE, PHOTO) })).toEqual(
      PHOTO,
    );
  });

  it('Apple：改取英文期间先交出的主图同样按页面地址里的艺人 ID 核对', () => {
    expect(onlinePhotoOf(appleInput('3296287'), { photo: PHOTO })).toEqual(PHOTO);
    expect(
      onlinePhotoOf(appleInput('3296287'), {
        photo: { ...PHOTO, pageUrl: 'https://music.apple.com/cn/artist/someone/111' },
      }),
    ).toBeNull();
  });

  it('墙上的缓存艺术照：手选优先、「不关联任何艺人」没有，否则用身份缓存认定的那位；哪种语言的缓存在都行', () => {
    const entry = (photo: BiographyPhoto | null) => ({
      source: 'apple' as const,
      sourceId: '3296287',
      artist: 'Queen',
      language: 'en' as const,
      fetchedAt: 1,
      expiresAt: 2,
      document: null,
      details: { ...appleDetails(PAGE), ...(photo ? { photo } : {}) },
    });
    const texts = {
      get: (id: string, language: string) =>
        id === '3296287' && language === 'en' ? entry(PHOTO) : undefined,
    };
    const resolved = {
      get: (artist: string) =>
        artist === 'Queen'
          ? {
              artist,
              status: 'resolved' as const,
              sourceId: '3296287',
              sourceArtist: 'Queen',
              url: PAGE,
              candidates: [],
              fetchedAt: 1,
              expiresAt: 2,
            }
          : undefined,
    };
    const none = { get: () => undefined };
    expect(cachedApplePhoto('Queen', [], resolved, texts)).toEqual(PHOTO);
    expect(
      cachedApplePhoto(
        'Queen',
        [{ artist: 'Queen', sourceId: '3296287', sourceArtist: 'Queen', url: PAGE }],
        none,
        texts,
      ),
    ).toEqual(PHOTO);
    expect(
      cachedApplePhoto('Queen', [{ artist: 'Queen', declined: true }], resolved, texts),
    ).toBeNull();
    expect(cachedApplePhoto('Queen', [], none, texts)).toBeNull();
    expect(cachedApplePhoto('Queen', [], resolved, { get: () => entry(TAISHI_PHOTO) })).toBeNull();
    // 合辑不取联网素材
    expect(cachedApplePhoto('Various Artists', [], resolved, texts)).toBeNull();
  });

  it('身份还没确认时没有图', () => {
    expect(
      onlinePhotoOf(appleInput(null), { document: appleDocument('3296287', PHOTO) }),
    ).toBeNull();
    expect(onlinePhotoOf(null, { document: appleDocument('3296287', PHOTO) })).toBeNull();
  });

  it('Last.fm：按来源给的艺人名核对；文档里是 Apple 的图时不当 Last.fm 的图', () => {
    const document: BiographyDocument = {
      source: 'lastfm',
      sourceId: 'Taishi',
      artist: 'Taishi',
      language: 'zh',
      paragraphs: ['x'],
      url: 'https://www.last.fm/zh/music/Taishi/+wiki',
      attribution: { name: 'Last.fm', url: 'https://www.last.fm/zh/music/Taishi/+wiki' },
      photo: TAISHI_PHOTO,
    };
    expect(onlinePhotoOf(lastfmInput('Taishi', 'Taishi', 'zh'), { document })).toEqual(
      TAISHI_PHOTO,
    );
    expect(onlinePhotoOf(lastfmInput('Other', 'Other', 'zh'), { document })).toBeNull();
    expect(
      onlinePhotoOf(lastfmInput('Taishi', 'Taishi', 'zh'), {
        document: { ...document, photo: PHOTO },
      }),
    ).toBeNull();
  });
});
