/** PE 头与版本资源：核对架构、文件类型，并读宿主 exe 的四段文件版本。 */

export function checkPe(bytes: Uint8Array, arch: 'x64' | 'x86', dll = true): void {
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error('不是 PE 文件');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = view.getUint32(0x3c, true);
  if (
    offset > bytes.length - 24 ||
    view.getUint32(offset, true) !== 0x4550 ||
    view.getUint16(offset + 4, true) !== (arch === 'x64' ? 0x8664 : 0x14c) ||
    (view.getUint16(offset + 22, true) & 0x2000) !== (dll ? 0x2000 : 0)
  )
    throw new Error('PE 架构或文件类型不符');
}

/** 取 VS_FIXEDFILEINFO 的四段文件版本，签名发行的 `hosts` 按它逐字比较。 */
export function fileVersion(bytes: Buffer): string {
  const key = bytes.indexOf(Buffer.from('VS_VERSION_INFO\0', 'utf16le'));
  // 键名占 32 字节，之后补齐到 4 字节边界，再接以 0xFEEF04BD 开头的固定版本信息，所以签名只会出现在
  // 键名后 0 到 3 字节处。
  const at = key < 0 ? -1 : bytes.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]), key + 32);
  if (at < 0 || at > key + 35 || at + 16 > bytes.length) throw new Error('宿主文件版本不可读');
  const high = bytes.readUInt32LE(at + 8);
  const low = bytes.readUInt32LE(at + 12);
  return [high >>> 16, high & 0xffff, low >>> 16, low & 0xffff].join('.');
}
