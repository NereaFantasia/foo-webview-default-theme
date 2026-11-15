import { describe, expect, it } from 'vitest';
import {
  appleImageBase,
  appleImageUrl,
  appleLogoUrl,
  appleVideoUrl,
  readAppleClipFromPage,
  readAppleLogo,
  readApplePhoto,
  readAppleMotion,
  readAppleWide,
} from '../../../../../src/library/biography/apple/appleMedia.ts';

const THUMB = 'https://is1-ssl.mzstatic.com/image/thumb/Features115/v4/92/51/6a/mza_1.png';
const HLS = 'https://mvod.itunes.apple.com/itunes-assets/HLSMusic221/v4/cd/10/P1_default.m3u8';

describe('Apple 图片与视频地址', () => {
  it('图片地址去掉末段的尺寸与格式，模板和具体尺寸都认；基础地址再过一遍还是它自己', () => {
    expect(appleImageBase(`${THUMB}/486x486bb.png`)).toBe(THUMB);
    expect(appleImageBase(`${THUMB}/{w}x{h}{c}.{f}`)).toBe(THUMB);
    expect(appleImageBase(`${THUMB}/{w}x{h}.{f}`)).toBe(THUMB);
    expect(appleImageBase(THUMB)).toBe(THUMB);
  });

  it('图片只认 mzstatic.com 的 https 图片路径，带端口、账号、查询串或残留模板的不要', () => {
    for (const bad of [
      'http://is1-ssl.mzstatic.com/image/thumb/a/b.png',
      'https://evil.example/image/thumb/a/b.png',
      'https://notmzstatic.com/image/thumb/a/b.png',
      'https://is1-ssl.mzstatic.com:8443/image/thumb/a/b.png',
      'https://user@is1-ssl.mzstatic.com/image/thumb/a/b.png',
      'https://is1-ssl.mzstatic.com/image/thumb/a/b.png?x=1',
      'https://is1-ssl.mzstatic.com/other/a/b.png',
      'https://is1-ssl.mzstatic.com/image/thumb/{w}/b.png',
      42,
    ])
      expect(appleImageBase(bad)).toBeNull();
  });

  it('按显示尺寸拼出取图地址', () => {
    expect(appleImageUrl(THUMB, 600, 600, 'jpg')).toBe(`${THUMB}/600x600bb.jpg`);
    expect(appleImageUrl(THUMB, 600, 196, 'png', 'bb')).toBe(`${THUMB}/600x196bb.png`);
  });

  it('视频只认 mvod.itunes.apple.com 的 HLS 主列表', () => {
    expect(appleVideoUrl(HLS)).toBe(HLS);
    expect(appleVideoUrl(HLS.replace('mvod.itunes.apple.com', 'example.com'))).toBeNull();
    expect(appleVideoUrl(HLS.replace('.m3u8', '.mp4'))).toBeNull();
    expect(appleVideoUrl(`${HLS}?token=1`)).toBeNull();
  });

  it('艺术字图片的尺寸可以是数字或数字串，读不出尺寸的整项不要', () => {
    const url = 'https://is1-ssl.mzstatic.com/image/thumb/kHc61lZyatgbQwRGiiug-A/{w}x{h}{c}.{f}';
    const base = 'https://is1-ssl.mzstatic.com/image/thumb/kHc61lZyatgbQwRGiiug-A';
    expect(readAppleLogo({ url, width: 2930, height: 958 })).toEqual({
      url: base,
      width: 2930,
      height: 958,
    });
    expect(readAppleLogo({ url, width: '2930', height: '958' })).toEqual({
      url: base,
      width: 2930,
      height: 958,
    });
    expect(readAppleLogo({ url, width: 0, height: 958 })).toBeNull();
    expect(readAppleLogo({ url, width: 'x', height: 958 })).toBeNull();
    expect(readAppleLogo(null)).toBeNull();
  });

  it('页面里的动态艺术照项取视频和静帧模板，缺哪一样都不要', () => {
    const clip = { video: HLS, previewFrame: { url: `${THUMB}/{w}x{h}{c}.{f}` } };
    expect(readAppleClipFromPage(clip)).toEqual({ video: HLS, poster: THUMB });
    expect(readAppleClipFromPage({ video: HLS })).toBeNull();
    expect(readAppleClipFromPage({ ...clip, video: 'https://example.com/a.m3u8' })).toBeNull();
  });

  it('缓存里的宽幅图要有合格的基础地址和两个小写字母的裁切码', () => {
    expect(readAppleWide({ url: `${THUMB}/1600x900vf.jpg`, crop: 'vf' })).toEqual({
      url: THUMB,
      crop: 'vf',
    });
    for (const bad of [
      { url: THUMB, crop: 'VF' },
      { url: THUMB, crop: 'vff' },
      { url: THUMB },
      { url: 'https://example.com/image/a', crop: 'vf' },
      null,
    ])
      expect(readAppleWide(bad)).toBeNull();
  });

  it('艺术字图片按原图宽高比取 800 宽的 png，原图更窄就取原尺寸', () => {
    const base = THUMB;
    expect(appleLogoUrl({ url: base, width: 2930, height: 958 })).toBe(`${base}/800x262bb.png`);
    expect(appleLogoUrl({ url: base, width: 500, height: 200 })).toBe(`${base}/500x200bb.png`);
    expect(appleLogoUrl({ url: base, width: 3000, height: 1 })).toBe(`${base}/800x1bb.png`);
  });

  it('静帧的底色是六位十六进制，页面里的、缓存里的都照这个校验，不合格的丢掉底色但留着图', () => {
    const clip = {
      video: HLS,
      previewFrame: { url: `${THUMB}/{w}x{h}{c}.{f}`, bgColor: '050609' },
    };
    expect(readAppleClipFromPage(clip)).toEqual({ video: HLS, poster: THUMB, color: '050609' });
    expect(
      readAppleClipFromPage({ ...clip, previewFrame: { ...clip.previewFrame, bgColor: 'red' } }),
    ).toEqual({ video: HLS, poster: THUMB });
    expect(readAppleWide({ url: THUMB, crop: 'bb', color: 'F3D8DC' })).toEqual({
      url: THUMB,
      crop: 'bb',
      color: 'f3d8dc',
    });
    expect(readAppleWide({ url: THUMB, crop: 'bb', color: '#050609' })).toEqual({
      url: THUMB,
      crop: 'bb',
    });
  });

  it('缓存里的艺术照带着宽幅图一起读回，宽幅图坏了不影响艺术照', () => {
    const base = THUMB;
    const page = 'https://music.apple.com/cn/artist/queen/3296287';
    const photo = { source: 'apple', url: base, pageUrl: page };
    expect(readApplePhoto({ ...photo, wide: { url: base, crop: 'vf' } }, page)).toEqual({
      ...photo,
      wide: { url: base, crop: 'vf' },
    });
    expect(readApplePhoto({ ...photo, wide: { url: 'x', crop: 'vf' } }, page)).toEqual(photo);
    expect(readApplePhoto(photo, page)).toEqual(photo);
  });

  it('缓存里的动态艺术照两种至少要有一种，坏的一种单独丢掉', () => {
    const wide = { video: HLS, poster: THUMB };
    expect(readAppleMotion({ wide })).toEqual({ wide });
    expect(readAppleMotion({ square: { video: 'x', poster: THUMB }, wide })).toEqual({ wide });
    expect(readAppleMotion({ square: { video: 'x', poster: 'y' } })).toBeNull();
    expect(readAppleMotion([])).toBeNull();
  });
});
