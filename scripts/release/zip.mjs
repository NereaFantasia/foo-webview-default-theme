// 发行包的 zip 写入。只写 stored 与 deflate，不写 zip64、加密和额外字段，时间戳固定为 1980-01-01，
// 同样的输入得到同样的字节。zipForRelease 打包后用客户端的解包代码核对一遍，客户端不认的包不发布。

import { crc32, deflateRawSync } from 'node:zlib';
import { readZip } from '../../src/update/zipArchive.ts';

/** DOS 日期 1980-01-01：年份偏移 0、月 1、日 1。 */
const DOS_DATE = (1 << 5) | 1;

/**
 * 按给定顺序写条目；文件名原样写入，不做任何检查。
 * @param {{ path: string, bytes: Uint8Array, method?: 0 | 8 }[]} files
 * @param {string} [comment]
 */
export function zipEntries(files, comment = '') {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const { path, bytes, method = 8 } of files) {
    const name = Buffer.from(path, 'utf8');
    const data = method === 8 ? deflateRawSync(bytes) : Buffer.from(bytes);
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const note = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(note.length, 20);
  return new Uint8Array(Buffer.concat([...locals, directory, end, note]));
}

/**
 * 按路径排序后打包并核对：客户端必须原样解出同样的文件与字节。
 * @param {{ path: string, bytes: Uint8Array }[]} files
 */
export async function zipForRelease(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const zip = zipEntries(sorted);
  const reading = await readZip(zip);
  if (!reading.ok) throw new Error(`客户端不认这个包：${reading.problem}`);
  if (
    reading.files.length !== sorted.length ||
    reading.files.some(
      (file, index) =>
        file.path !== sorted[index]?.path ||
        Buffer.compare(Buffer.from(file.bytes), Buffer.from(sorted[index].bytes)) !== 0,
    )
  )
    throw new Error('客户端解出的内容与打包的文件不一致');
  return zip;
}
