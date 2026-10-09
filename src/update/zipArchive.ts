/**
 * 解开前端发行包。只支持 stored 与 deflate，按中央目录读取；zip64、加密、多卷以及文件名写进 Windows
 * 目录会出问题的包整个作废，不跳过个别条目。哈希已在下载后按附件字节核对，这里再逐个核对 CRC32
 * 与解压后的长度。
 */

export interface ZipFile {
  /** 以 `/` 分隔的相对路径，只含可打印 ASCII。 */
  readonly path: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}
export type ZipProblem =
  /** 结构损坏或数据越界。 */
  | 'format'
  /** zip64、加密、多卷或 stored、deflate 之外的压缩方式。 */
  | 'unsupported'
  /** 文件名不能安全写进 Windows 目录：绝对路径、`..`、保留名、非 ASCII、大小写冲突等。 */
  | 'name'
  /** 解压后的长度或 CRC32 与目录记录不符。 */
  | 'content'
  /** 条目数或解压总量超过上限。 */
  | 'size';
export type ZipReading =
  | { readonly ok: true; readonly files: readonly ZipFile[] }
  | { readonly ok: false; readonly problem: ZipProblem };

const MAX_FILES = 4096;
/** 前端解压后约 3 MB，留足余量，同时挡住压缩炸弹。 */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_PATH = 200;
const EOCD_SIZE = 22;
const RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;
const FORBIDDEN = /[<>:"\\|?*]/;

interface Entry {
  readonly path: string;
  readonly method: number;
  readonly crc: number;
  readonly compressed: number;
  readonly size: number;
  /** 本地头的起点；条目占据从这里到数据末尾的范围，各条目的范围不能重叠。 */
  readonly header: number;
  /** 压缩数据的起点。 */
  readonly offset: number;
}

/** 本模块也由 Node 直接加载，Node 只剥类型，所以不用构造参数属性。 */
class Problem extends Error {
  readonly problem: ZipProblem;

  constructor(problem: ZipProblem) {
    super(problem);
    this.problem = problem;
  }
}
function fail(problem: ZipProblem): never {
  throw new Problem(problem);
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function checkPath(path: string): void {
  if (!path.length || path.length > MAX_PATH) fail('name');
  for (const segment of path.split('/')) {
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      FORBIDDEN.test(segment) ||
      /[. ]$/.test(segment) ||
      RESERVED.test(segment)
    )
      fail('name');
  }
}

function readEntries(data: Uint8Array<ArrayBuffer>): Entry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const inside = (start: number, length: number, end = data.length) =>
    start >= 0 && length >= 0 && start + length <= end;

  // 注释长度必须让目录尾记录正好落在文件末尾，避免把注释里伪造的签名当成目录尾。
  let eocd = -1;
  for (
    let at = data.length - EOCD_SIZE;
    at >= Math.max(0, data.length - EOCD_SIZE - 0xffff);
    at -= 1
  )
    if (u32(at) === 0x06054b50 && at + EOCD_SIZE + u16(at + 20) === data.length) {
      eocd = at;
      break;
    }
  if (eocd < 0) fail('format');
  if (eocd >= 20 && u32(eocd - 20) === 0x07064b50) fail('unsupported');
  const count = u16(eocd + 10);
  const directorySize = u32(eocd + 12);
  const directory = u32(eocd + 16);
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0 || u16(eocd + 8) !== count) fail('unsupported');
  if (count === 0xffff || directorySize === 0xffffffff || directory === 0xffffffff)
    fail('unsupported');
  if (count > MAX_FILES) fail('size');
  if (!inside(directory, directorySize, eocd)) fail('format');

  const entries: Entry[] = [];
  let at = directory;
  for (let index = 0; index < count; index += 1) {
    if (!inside(at, 46, directory + directorySize) || u32(at) !== 0x02014b50) fail('format');
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const compressed = u32(at + 20);
    const size = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    const offset = u32(at + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (!inside(at, recordLength, directory + directorySize)) fail('format');
    if (flags & 0x2041 || u16(at + 34) !== 0) fail('unsupported');
    if (method !== 0 && method !== 8) fail('unsupported');
    if ([compressed, size, offset].includes(0xffffffff)) fail('unsupported');
    for (let extra = at + 46 + nameLength; extra + 4 <= at + 46 + nameLength + extraLength;) {
      if (u16(extra) === 0x0001) fail('unsupported');
      extra += 4 + u16(extra + 2);
    }
    const nameBytes = data.subarray(at + 46, at + 46 + nameLength);
    if (nameBytes.some((byte) => byte < 0x20 || byte > 0x7e)) fail('name');
    const path = String.fromCharCode(...nameBytes);

    if (!inside(offset, 30, directory) || u32(offset) !== 0x04034b50) fail('format');
    const localNameLength = u16(offset + 26);
    const localName = data.subarray(offset + 30, offset + 30 + localNameLength);
    if (
      u16(offset + 6) & 0x2041 ||
      u16(offset + 8) !== method ||
      localNameLength !== nameLength ||
      localName.some((byte, position) => byte !== nameBytes[position])
    )
      fail('format');
    const start = offset + 30 + localNameLength + u16(offset + 28);
    if (!inside(start, compressed, directory)) fail('format');
    entries.push({
      path,
      method,
      crc: u32(at + 16),
      compressed,
      size,
      header: offset,
      offset: start,
    });
    at += recordLength;
  }
  return entries;
}

function checkLayout(entries: readonly Entry[]): Entry[] {
  const files = entries.filter((entry) => !entry.path.endsWith('/'));
  for (const entry of entries) {
    if (entry.path.endsWith('/')) {
      if (entry.size !== 0 || entry.compressed !== 0) fail('format');
      checkPath(entry.path.slice(0, -1));
    } else checkPath(entry.path);
  }
  const paths = new Set<string>();
  const folders = new Set<string>();
  for (const { path } of files) {
    const lower = path.toLowerCase();
    if (paths.has(lower)) fail('name');
    paths.add(lower);
    const segments = lower.split('/');
    for (let depth = 1; depth < segments.length; depth += 1)
      folders.add(segments.slice(0, depth).join('/'));
  }
  if ([...paths].some((path) => folders.has(path))) fail('name');
  const ordered = [...entries].sort((a, b) => a.header - b.header);
  for (let index = 1; index < ordered.length; index += 1) {
    const before = ordered[index - 1]!;
    if (before.offset + before.compressed > ordered[index]!.header) fail('format');
  }
  if (files.reduce((total, entry) => total + entry.size, 0) > MAX_TOTAL_BYTES) fail('size');
  return files;
}

export async function inflate(
  input: Uint8Array<ArrayBuffer>,
  size: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const output = new Uint8Array(size);
  const reader = new Blob([input])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  let at = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > size) {
        await reader.cancel();
        fail('content');
      }
      output.set(value, at);
      at += value.length;
    }
  } catch (error) {
    if (error instanceof Problem) throw error;
    fail('content');
  }
  if (at !== size) fail('content');
  return output;
}

export async function readZip(data: Uint8Array<ArrayBuffer>): Promise<ZipReading> {
  try {
    const files: ZipFile[] = [];
    for (const entry of checkLayout(readEntries(data))) {
      const raw = data.slice(entry.offset, entry.offset + entry.compressed);
      if (entry.method === 0 && entry.compressed !== entry.size) fail('content');
      const bytes = entry.method === 0 ? raw : await inflate(raw, entry.size);
      if (crc32(bytes) !== entry.crc) fail('content');
      files.push({ path: entry.path, bytes });
    }
    return { ok: true, files };
  } catch (error) {
    if (error instanceof Problem) return { ok: false, problem: error.problem };
    throw error;
  }
}
