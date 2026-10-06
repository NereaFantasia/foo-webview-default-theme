import { describe, expect, it } from 'vitest';
import { zipEntries, zipForRelease } from '../../../scripts/release/zip.mjs';
import { crc32, readZip } from '../../../src/update/zipArchive.ts';

const text = (value: string) => new TextEncoder().encode(value);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** 中央目录第 index 个条目的起点；测试包都没有注释、条目名长度已知。 */
function central(zip: Uint8Array, index = 0): number {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let at = view.getUint32(zip.length - 6, true);
  for (let skip = 0; skip < index; skip += 1)
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true);
  return at;
}
function patch(zip: Uint8Array, at: number, value: number, bytes: 2 | 4): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(zip);
  const view = new DataView(copy.buffer);
  if (bytes === 2) view.setUint16(at, value, true);
  else view.setUint32(at, value, true);
  return copy;
}
async function problem(zip: Uint8Array<ArrayBuffer>) {
  const reading = await readZip(zip);
  return reading.ok ? 'ok' : reading.problem;
}
const names = (...paths: string[]) =>
  zipEntries(paths.map((path) => ({ path, bytes: text(path) })));

describe('readZip', () => {
  it('解出 stored 与 deflate 条目，跳过目录条目', async () => {
    const big = 'Fluent '.repeat(5000);
    const zip = zipEntries([
      { path: 'index.html', bytes: text('<!doctype html>'), method: 0 },
      { path: 'assets/', bytes: new Uint8Array(), method: 0 },
      { path: 'assets/App.js', bytes: text(big) },
      { path: 'empty.txt', bytes: new Uint8Array() },
    ]);
    const reading = await readZip(zip);
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.files.map((file) => [file.path, decode(file.bytes).length])).toEqual([
      ['index.html', 15],
      ['assets/App.js', big.length],
      ['empty.txt', 0],
    ]);
    expect(decode(reading.files[1]!.bytes)).toBe(big);
  });

  it('只认正好落在文件末尾的目录尾，注释里伪造的签名不算', async () => {
    // 伪造的签名后面要留够一条目录尾的长度，倒着扫描才会先碰到它。
    const zip = zipEntries(
      [{ path: 'a.txt', bytes: text('a') }],
      `PK\u0005\u0006${' '.repeat(40)}`,
    );
    expect(await problem(zip)).toBe('ok');
  });

  it('截断或不是 zip 时报结构损坏', async () => {
    const zip = names('a.txt');
    expect(await problem(zip.slice(0, zip.length - 1))).toBe('format');
    expect(await problem(text('<html>门户页</html>'))).toBe('format');
    expect(await problem(new Uint8Array(10))).toBe('format');
  });

  it('加密、zip64 与不支持的压缩方式整个包作废', async () => {
    const zip = names('a.txt');
    const at = central(zip);
    expect(await problem(patch(zip, at + 8, 1, 2))).toBe('unsupported');
    expect(await problem(patch(zip, at + 10, 12, 2))).toBe('unsupported');
    expect(await problem(patch(zip, at + 20, 0xffffffff, 4))).toBe('unsupported');
    expect(await problem(patch(zip, zip.length - 18, 1, 2))).toBe('unsupported');
  });

  it('文件名不能安全写进 Windows 目录时整个包作废', async () => {
    for (const bad of [
      '../a.txt',
      '/a.txt',
      'a\\b.txt',
      'a//b.txt',
      'CON',
      'con.txt',
      'assets/nul',
      'COM1.js',
      'lpt9',
      'a.',
      'a ',
      'a:b',
      'a?.txt',
      '中.txt',
      `${'x'.repeat(201)}`,
    ])
      expect(await problem(names('ok.txt', bad)), bad).toBe('name');
    expect(await problem(names('A.txt', 'a.txt'))).toBe('name');
    expect(await problem(names('assets', 'Assets/app.js'))).toBe('name');
    expect(await problem(names('com10.txt', 'console.txt', 'auxiliary/a'))).toBe('ok');
  });

  it('CRC、解压长度或 deflate 数据不符时报内容错误', async () => {
    const zip = zipEntries([{ path: 'a.txt', bytes: text('hello hello hello') }]);
    const at = central(zip);
    expect(await problem(patch(zip, at + 16, 0, 4))).toBe('content');
    expect(await problem(patch(zip, at + 24, 3, 4))).toBe('content');
    expect(await problem(patch(zip, at + 24, 100, 4))).toBe('content');
    const stored = zipEntries([{ path: 'a.txt', bytes: text('abc'), method: 0 }]);
    expect(await problem(patch(stored, central(stored) + 24, 2, 4))).toBe('content');
    const junk = new Uint8Array(zip);
    junk[30 + 'a.txt'.length] = 0xff;
    expect(await problem(junk)).toBe('content');
  });

  it('本地头与中央目录对不上、条目数据重叠时报结构损坏', async () => {
    const zip = names('a.txt', 'b.txt');
    const local = new Uint8Array(zip);
    local[30] = 'c'.charCodeAt(0);
    expect(await problem(local)).toBe('format');
    expect(await problem(patch(zip, central(zip, 1) + 42, 0, 4))).toBe('format');
    // 前一个条目的压缩长度伸进后一个条目：文件名都对得上，只有重叠检查能拦住。
    const deflated = zipEntries([
      { path: 'a.txt', bytes: text('a'.repeat(100)) },
      { path: 'b.txt', bytes: text('b') },
    ]);
    const size = new DataView(deflated.buffer).getUint32(central(deflated) + 20, true);
    expect(await problem(patch(deflated, central(deflated) + 20, size + 10, 4))).toBe('format');
  });

  it('解压总量或条目数超过上限时报超限', async () => {
    const zip = names('a.txt');
    expect(await problem(patch(zip, central(zip) + 24, 0xf0000000, 4))).toBe('size');
    const many = zipEntries(
      Array.from({ length: 4097 }, (_, index) => ({ path: `f${index}`, bytes: new Uint8Array() })),
    );
    expect(await problem(many)).toBe('size');
  });
});

describe('zipForRelease', () => {
  it('按路径排序打包，客户端原样解出', async () => {
    const zip = await zipForRelease([
      { path: 'b/app.js', bytes: text('b') },
      { path: 'a.html', bytes: text('a') },
    ]);
    const reading = await readZip(zip);
    expect(reading.ok && reading.files.map((file) => file.path)).toEqual(['a.html', 'b/app.js']);
  });

  it('客户端不认的包不发布', async () => {
    await expect(zipForRelease([{ path: 'con.txt', bytes: text('x') }])).rejects.toThrow('name');
  });
});

describe('crc32', () => {
  it('与标准校验值一致', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
  });
});
