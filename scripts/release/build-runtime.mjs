// 从官方校验表核对 Node 原始字节，生成可供多个主题发行版复用的运行时附件；只写本地。
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isStableVersion } from '../../src/update/contract.ts';
import { runtimeArtifacts } from './runtime-artifacts.mjs';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    arch: { type: 'string', default: 'x64' },
    out: { type: 'string' },
    node: { type: 'string' },
  },
});
if (!isStableVersion(values.version) || !values.out || !['x64', 'arm64'].includes(values.arch))
  throw new Error('需要 --version、--out，--arch 只能为 x64 或 arm64');
const version = values.version;
const arch = values.arch === 'arm64' ? 'arm64' : 'x64';
const file = `win-${arch}/node.exe`;
const base = `https://nodejs.org/dist/v${version}`;
const tag = `rt-node-${version}-win-${arch}`;
const out = join(values.out, tag);
if (existsSync(out)) throw new Error('运行时输出目录已存在，不能覆盖发行附件');

/** @param {string} url */
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
console.log(`核对 Node ${version} ${arch} 的官方校验表`);
const sums = new TextDecoder().decode(await download(`${base}/SHASUMS256.txt`));
const line = sums
  .split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/))
  .find((entry) => entry[1] === file);
const expected = line?.[0];
if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new Error('官方校验表没有目标文件');
const node = values.node
  ? new Uint8Array(readFileSync(values.node))
  : await download(`${base}/${file}`);
const license = await download(`https://raw.githubusercontent.com/nodejs/node/v${version}/LICENSE`);
const result = runtimeArtifacts({
  version,
  arch,
  node,
  license,
  source: { url: `${base}/${file}`, size: node.length, sha256: expected },
});
mkdirSync(out, { recursive: true });
for (const asset of result.assets) writeFileSync(join(out, asset.name), asset.bytes);
console.log(
  JSON.stringify({ out, tag, files: result.assets.length, sha256: result.manifest.sha256 }),
);
