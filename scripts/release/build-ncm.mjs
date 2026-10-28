// 生成网易云组件附件，只写到本地目录，不上传：ncm-<版本>.zip 与组件描述 ncm.json
// 构建带后端的主题时把这份 ncm.json 交给 build-release 的 --ncm
//
// 用法：node scripts/release/build-ncm.mjs --out <目录>

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ncmArtifacts, verifyComponentArtifacts } from './ncm-artifacts.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) throw new Error('需要 --out');
const built = await ncmArtifacts(fileURLToPath(new URL('../..', import.meta.url)));
const out = join(values.out, built.tag);
if (existsSync(out)) throw new Error(`${out} 已存在，附件发出去就不能再改，换个目录`);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, built.name), built.bytes);
writeFileSync(join(out, 'ncm.json'), built.text);
verifyComponentArtifacts(out, 'ncm');
console.log(
  JSON.stringify({
    tag: built.tag,
    packages: built.packages,
    files: built.files,
    size: built.component.size,
    unpackedSize: built.component.unpackedSize,
    sha256: built.component.sha256,
    out: relative(process.cwd(), out),
  }),
);
