/**
 * 按文件头判断一张封面是不是动图：GIF 数到第二帧，WebP 看 VP8X 的动画位，APNG 看 IDAT 之前有没有 acTL。
 * 只读文件开头，其余格式一律按静图
 *
 * - `animated`：确定是动图
 * - `still`：确定是静图，不必再读
 * - `more`：已有的字节不够判断，读到更多再问；流已读完仍是 `more` 的按静图（文件被截断）
 */
export type AnimationScan = 'animated' | 'still' | 'more';

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

function textAt(bytes: Uint8Array, index: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(index, index + length));
}

/** 跳过一串子块（长度字节加数据，长度 0 收尾），答收尾之后的位置；字节不够答 -1 */
function skipSubBlocks(bytes: Uint8Array, from: number): number {
  let at = from;
  while (at < bytes.length) {
    const size = byteAt(bytes, at);
    at += 1 + size;
    if (size === 0) return at;
  }
  return -1;
}

/** 调色板的字节数；标志位里最高位为有调色板，低三位是 2 的幂次减一 */
function paletteSize(flags: number): number {
  return flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0;
}

function scanGif(bytes: Uint8Array): AnimationScan {
  if (bytes.length < 13) return 'more';
  let at = 13 + paletteSize(byteAt(bytes, 10));
  let frames = 0;
  while (at < bytes.length) {
    const block = byteAt(bytes, at);
    if (block === 0x3b) return 'still';
    if (block === 0x21) {
      // 扩展块：引导字节与标签各一个字节，之后是子块
      at = skipSubBlocks(bytes, at + 2);
    } else if (block === 0x2c) {
      if (at + 10 > bytes.length) return 'more';
      // 图像描述符 9 字节，可带局部调色板，之后是一个 LZW 码长字节与图像数据子块
      at = skipSubBlocks(bytes, at + 10 + paletteSize(byteAt(bytes, at + 9)) + 1);
      frames += 1;
      if (frames > 1) return 'animated';
    } else return 'still';
    if (at < 0) return 'more';
  }
  return 'more';
}

function scanWebp(bytes: Uint8Array): AnimationScan {
  if (bytes.length < 21) return 'more';
  return textAt(bytes, 12, 4) === 'VP8X' && byteAt(bytes, 20) & 0x02 ? 'animated' : 'still';
}

const PNG_SIGNATURE = '\x89PNG\r\n\x1a\n';

function scanPng(bytes: Uint8Array): AnimationScan {
  let at = PNG_SIGNATURE.length;
  while (at + 8 <= bytes.length) {
    const type = textAt(bytes, at + 4, 4);
    if (type === 'acTL') return 'animated';
    if (type === 'IDAT' || type === 'IEND') return 'still';
    const length =
      byteAt(bytes, at) * 2 ** 24 +
      (byteAt(bytes, at + 1) << 16) +
      (byteAt(bytes, at + 2) << 8) +
      byteAt(bytes, at + 3);
    // 长度加类型各 4 字节、数据、校验 4 字节
    at += 12 + length;
  }
  return 'more';
}

export function scanAnimation(bytes: Uint8Array): AnimationScan {
  if (bytes.length < 12) return 'more';
  const head = textAt(bytes, 0, 4);
  if (head === 'GIF8') return scanGif(bytes);
  if (head === 'RIFF' && textAt(bytes, 8, 4) === 'WEBP') return scanWebp(bytes);
  if (textAt(bytes, 0, PNG_SIGNATURE.length) === PNG_SIGNATURE) return scanPng(bytes);
  return 'still';
}
