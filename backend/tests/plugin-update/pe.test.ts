import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPe, fileVersion } from '../../plugin-update/pe.ts';

function resource(padding: number, [a, b, c, d]: readonly number[]): Buffer {
  const fixed = Buffer.alloc(16);
  fixed.writeUInt32LE(0xfeef04bd, 0);
  fixed.writeUInt32LE(0x10000, 4);
  fixed.writeUInt32LE((a! << 16) | b!, 8);
  fixed.writeUInt32LE((c! << 16) | d!, 12);
  return Buffer.concat([
    Buffer.alloc(6, 1),
    Buffer.from('VS_VERSION_INFO\0', 'utf16le'),
    Buffer.alloc(padding),
    fixed,
  ]);
}

describe('宿主程序的版本与类型', () => {
  it.each([0, 2])('从固定版本信息取四段文件版本（对齐填充 %i 字节）', (padding) => {
    expect(fileVersion(resource(padding, [2, 25, 8, 0]))).toBe('2.25.8.0');
  });
  it('没有版本资源或签名错位时报错', () => {
    expect(() => fileVersion(Buffer.alloc(64))).toThrow('版本不可读');
    expect(() => fileVersion(resource(8, [2, 25, 8, 0]))).toThrow('版本不可读');
  });
  it.runIf(process.platform === 'win32')('读取实际 Windows 程序，并区分程序与 DLL', () => {
    const bytes = readFileSync(process.execPath);
    expect(fileVersion(bytes)).toBe(`${process.versions.node}.0`);
    const arch = process.arch === 'x64' ? 'x64' : 'x86';
    expect(() => checkPe(bytes, arch, false)).not.toThrow();
    expect(() => checkPe(bytes, arch)).toThrow('文件类型');
  });
});
