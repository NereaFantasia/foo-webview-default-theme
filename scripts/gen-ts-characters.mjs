// 生成歌词匹配用的繁转简单字表 src/lyrics/online/tsCharacters.ts。
// 数据取 OpenCC 的 data/dictionary/TSCharacters.txt（Apache-2.0），钉在下面的提交上；
// 只收「一个字对一个字」的条目，取第一个候选，与原字相同的不收。要跟上游时改 COMMIT 重跑。
//
// 用法：node scripts/gen-ts-characters.mjs
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = '3ac34aa439a9908dd49fa92b5174b46314787ac2';
const SOURCE = `https://raw.githubusercontent.com/BYVoid/OpenCC/${COMMIT}/data/dictionary/TSCharacters.txt`;
const OUT = 'src/lyrics/online/tsCharacters.ts';
/** 每行放几对，只为生成物好读。 */
const PAIRS_PER_LINE = 40;

const root = resolve(fileURLToPath(import.meta.url), '../..');
const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`取 ${SOURCE} 失败：HTTP ${response.status}`);
const text = await response.text();

/** @type {string[]} */
const pairs = [];
for (const line of text.split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [key = '', values = ''] = line.split('\t');
  const first = values.split(' ')[0] ?? '';
  if ([...key].length !== 1 || [...first].length !== 1 || key === first) continue;
  pairs.push(key + first);
}
if (pairs.length < 3000) throw new Error(`只解析出 ${pairs.length} 对，格式可能变了`);

const rows = [];
for (let index = 0; index < pairs.length; index += PAIRS_PER_LINE) {
  rows.push(`  '${pairs.slice(index, index + PAIRS_PER_LINE).join('')}',`);
}
const output = `// 繁体字到简体字的单字对照，每两个字一对：前一个繁体，后一个简体。
// 取自 OpenCC（https://github.com/BYVoid/OpenCC，Apache License 2.0）的 TSCharacters.txt，提交 ${COMMIT.slice(0, 10)}；
// 只收一个字对一个字的条目，取第一个候选。生成文件，不要手改。
export const TS_CHARACTER_PAIRS = [
${rows.join('\n')}
].join('');
`;
writeFileSync(join(root, OUT), output);
console.log(`${OUT}：${pairs.length} 对`);
