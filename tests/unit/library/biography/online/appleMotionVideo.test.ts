import { describe, expect, it } from 'vitest';
import {
  pickVariant,
  readMasterVariants,
  readMediaFile,
  resolveAppleMotionVideo,
} from '../../../../../src/library/biography/online/appleMotionVideo.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const BASE = 'https://mvod.itunes.apple.com/itunes-assets/HLSMusic211/v4/71/d3/P1_default.m3u8';
const DIR = 'https://mvod.itunes.apple.com/itunes-assets/HLSMusic211/v4/71/d3';

/** 照真实主列表的写法：I 帧列表、avc1 与 hvc1 两组、一档高动态范围 */
const MASTER = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  `#EXT-X-I-FRAME-STREAM-INF:AVERAGE-BANDWIDTH=179110,BANDWIDTH=189422,VIDEO-RANGE=SDR,CODECS="avc1.64001f",RESOLUTION=672x378,URI="${DIR}/P1_iframes.m3u8"`,
  `#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=255983,BANDWIDTH=270000,VIDEO-RANGE=SDR,CODECS="avc1.64001f",RESOLUTION=480x270`,
  `${DIR}/P1_480.m3u8`,
  `#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=507215,BANDWIDTH=530000,VIDEO-RANGE=SDR,CODECS="avc1.64001f",RESOLUTION=608x342`,
  `${DIR}/P1_608.m3u8`,
  `#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=2707295,BANDWIDTH=2800000,VIDEO-RANGE=SDR,CODECS="avc1.640028",RESOLUTION=1280x720`,
  'P1_1280.m3u8',
  `#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=9782314,BANDWIDTH=9900000,VIDEO-RANGE=SDR,CODECS="avc1.640028",RESOLUTION=1920x1080`,
  `${DIR}/P1_1920_high.m3u8`,
  `#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=3531137,BANDWIDTH=3600000,VIDEO-RANGE=SDR,CODECS="avc1.640028",RESOLUTION=1920x1080`,
  `${DIR}/P1_1920_low.m3u8`,
  `#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=400000,BANDWIDTH=420000,VIDEO-RANGE=SDR,CODECS="hvc1.1.6.L93.B0",RESOLUTION=608x342`,
  `${DIR}/P1_hvc_608.m3u8`,
  `#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=450000,BANDWIDTH=470000,VIDEO-RANGE=HLG,CODECS="avc1.64001f",RESOLUTION=608x342`,
  `${DIR}/P1_hlg_608.m3u8`,
].join('\n');

const MEDIA = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-MAP:URI="P1_video-.mp4",BYTERANGE="878@0"',
  '#EXTINF:5.5,',
  '#EXT-X-BYTERANGE:1094076@878',
  'P1_video-.mp4',
  '#EXTINF:3.8,',
  '#EXT-X-BYTERANGE:688737@1094954',
  'P1_video-.mp4',
  '#EXT-X-ENDLIST',
].join('\n');

function reply(status: number, body: string) {
  return { success: true as const, status, headers: {}, body, responseType: 'text' as const };
}

describe('动态艺术照：从 HLS 主列表找出 mp4 地址', () => {
  it('主列表里只收 avc1 且非高动态范围的档，I 帧列表与 hvc1 不要，相对地址按主列表补全', () => {
    const variants = readMasterVariants(MASTER, BASE);
    expect(variants.map((variant) => [variant.width, variant.bandwidth])).toEqual([
      [480, 255983],
      [608, 507215],
      [1280, 2707295],
      [1920, 9782314],
      [1920, 3531137],
    ]);
    expect(variants[2]?.uri).toBe(`${DIR}/P1_1280.m3u8`);
  });

  it('按头部宽度挑画面宽度不小于它八成的最窄一档；同宽的几档取码率最低的；都不够取最宽的', () => {
    const variants = readMasterVariants(MASTER, BASE);
    const pick = (width: number) => pickVariant(variants, width)?.uri.split('/').at(-1);
    expect(pick(300)).toBe('P1_480.m3u8');
    expect(pick(700)).toBe('P1_608.m3u8');
    expect(pick(1500)).toBe('P1_1280.m3u8');
    expect(pick(1700)).toBe('P1_1920_low.m3u8');
    expect(pick(3000)).toBe('P1_1920_low.m3u8');
    expect(pickVariant([], 1000)).toBeNull();
  });

  it('主列表没写分辨率时取码率最低的一档', () => {
    const bare = readMasterVariants(MASTER.replace(/,RESOLUTION=\d+x\d+/g, ''), BASE);
    expect(bare.every((variant) => variant.width === 0)).toBe(true);
    expect(pickVariant(bare, 1500)?.bandwidth).toBe(255983);
  });

  it('媒体列表是同一个文件的字节范围时给出那个 mp4，分成多个文件、地址不是 mvod 的 mp4 一律不认', () => {
    expect(readMediaFile(MEDIA, `${DIR}/P1_608.m3u8`)).toBe(`${DIR}/P1_video-.mp4`);
    expect(readMediaFile(`${MEDIA}\nP2_video-.mp4`, `${DIR}/P1_608.m3u8`)).toBeNull();
    expect(readMediaFile('#EXTM3U\nhttps://evil.test/a.mp4', `${DIR}/P1_608.m3u8`)).toBeNull();
    expect(readMediaFile('#EXTM3U\nseg.ts', `${DIR}/P1_608.m3u8`)).toBeNull();
  });

  it('取主列表、按头部宽度挑档、取媒体列表，答出 mp4 地址；只发两个请求，不跟随重定向', async () => {
    const host = installFakeHost();
    host.answer('http.get', (params: unknown) => {
      const url = String((params as { url?: unknown }).url);
      return url === BASE ? reply(200, MASTER) : reply(200, MEDIA);
    });
    expect(await resolveAppleMotionVideo(BASE, 700, host.fb)).toEqual({
      ok: true,
      url: `${DIR}/P1_video-.mp4`,
    });
    const calls = host.callsTo('http.get');
    expect(calls.map((call) => call['url'])).toEqual([BASE, `${DIR}/P1_608.m3u8`]);
    expect(calls[0]).toMatchObject({ redirect: 'error' });
  });

  it('任何一步取不到或读不出都给出隔多久再试，不发多余的请求', async () => {
    const down = installFakeHost();
    down.answer('http.get', reply(503, ''));
    const failed = await resolveAppleMotionVideo(BASE, 700, down.fb, () => 1000);
    expect(failed).toEqual({ ok: false, retryAt: 1000 + 5 * 60_000 });
    expect(down.callsTo('http.get')).toHaveLength(1);

    const stray = installFakeHost();
    expect(await resolveAppleMotionVideo('https://evil.test/a.m3u8', 700, stray.fb)).toMatchObject({
      ok: false,
    });
    expect(stray.callsTo('http.get')).toHaveLength(0);
  });
});
