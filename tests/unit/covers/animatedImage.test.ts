import { describe, expect, test } from 'vitest';
import { scanAnimation } from '../../../src/covers/animatedImage.ts';
import {
  ascii,
  bytes,
  GIF_CONTROL,
  GIF_END,
  GIF_FRAME,
  GIF_HEAD,
  JPEG,
} from '../../fixtures/imageBytes.ts';

function webp(flags: number): Uint8Array {
  return bytes(
    ascii('RIFF'),
    [30, 0, 0, 0],
    ascii('WEBP'),
    ascii('VP8X'),
    [10, 0, 0, 0],
    [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  );
}

const PNG_SIGNATURE = [0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a];
/** 数据全零的块：长度、类型、数据、校验 */
const chunk = (type: string, size: number) => [
  0,
  0,
  0,
  size,
  ...ascii(type),
  ...new Array<number>(size).fill(0),
  0,
  0,
  0,
  0,
];

describe('GIF', () => {
  test('两帧是动图', () => {
    const file = bytes(GIF_HEAD, GIF_CONTROL, GIF_FRAME, GIF_CONTROL, GIF_FRAME, GIF_END);
    expect(scanAnimation(file)).toBe('animated');
  });

  test('一帧是静图，读到结尾标记就能定', () => {
    expect(scanAnimation(bytes(GIF_HEAD, GIF_CONTROL, GIF_FRAME, GIF_END))).toBe('still');
  });

  test('带全局调色板与应用扩展也照样数帧', () => {
    const head = [...ascii('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
    const loop = [0x21, 0xff, 0x0b, ...ascii('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0x00];
    const file = bytes(head, loop, GIF_CONTROL, GIF_FRAME, GIF_FRAME, GIF_END);
    expect(scanAnimation(file)).toBe('animated');
  });

  test('第一帧还没读完时要更多字节，不当静图', () => {
    const file = bytes(GIF_HEAD, GIF_CONTROL, GIF_FRAME.slice(0, 8));
    expect(scanAnimation(file)).toBe('more');
  });

  test('一帧读完但结尾还没到时要更多字节', () => {
    expect(scanAnimation(bytes(GIF_HEAD, GIF_FRAME))).toBe('more');
  });

  test('第二帧的描述符出现了就够判动图，数据不必读完', () => {
    expect(scanAnimation(bytes(GIF_HEAD, GIF_FRAME, GIF_FRAME.slice(0, 4)))).toBe('more');
    expect(scanAnimation(bytes(GIF_HEAD, GIF_FRAME, GIF_FRAME.slice(0, 11)))).toBe('animated');
  });
});

describe('WebP', () => {
  test('VP8X 的动画位置位是动图', () => {
    expect(scanAnimation(webp(0x02))).toBe('animated');
  });

  test('只有透明度位是静图', () => {
    expect(scanAnimation(webp(0x10))).toBe('still');
  });

  test('简单格式没有 VP8X 是静图', () => {
    const file = bytes(
      ascii('RIFF'),
      [30, 0, 0, 0],
      ascii('WEBP'),
      ascii('VP8 '),
      new Array<number>(20).fill(0),
    );
    expect(scanAnimation(file)).toBe('still');
  });

  test('头部不够长时要更多字节', () => {
    expect(scanAnimation(webp(0x02).slice(0, 16))).toBe('more');
  });
});

describe('PNG', () => {
  const header = chunk('IHDR', 13);

  test('IDAT 之前有 acTL 是动图', () => {
    const file = bytes(PNG_SIGNATURE, header, chunk('acTL', 8), chunk('IDAT', 4));
    expect(scanAnimation(file)).toBe('animated');
  });

  test('先到 IDAT 是静图，acTL 在后面也不算', () => {
    const file = bytes(PNG_SIGNATURE, header, chunk('IDAT', 4), chunk('acTL', 8));
    expect(scanAnimation(file)).toBe('still');
  });

  test('前面有大块（如色彩配置）时读不全就要更多字节', () => {
    const file = bytes(PNG_SIGNATURE, header, chunk('iCCP', 200).slice(0, 100));
    expect(scanAnimation(file)).toBe('more');
  });
});

describe('其他格式', () => {
  test('JPEG 与 BMP 一律是静图', () => {
    expect(scanAnimation(JPEG)).toBe('still');
    expect(scanAnimation(bytes(ascii('BM'), new Array<number>(30).fill(1)))).toBe('still');
  });

  test('字节太少时要更多', () => {
    expect(scanAnimation(bytes(ascii('GIF8')))).toBe('more');
    expect(scanAnimation(new Uint8Array())).toBe('more');
  });
});
