// 生成一把根清单签名密钥。私钥以 PKCS#8 PEM 写到指定路径，只能放在本仓库之外离线保存；
// 标准输出打印 keyId 与 SPKI，供内置到主题或经已信任的根清单公布。目标文件已存在时拒绝覆盖。
//
// 用法：node scripts/release/keygen.mjs <keyId> <私钥输出路径>

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isKeyId } from '../../src/update/contract.ts';
import { verifySignature } from '../../src/update/rootTrust.ts';
import { publicSpki, signPayload } from './signing.mjs';

const [keyId, output] = process.argv.slice(2);
if (!keyId || !output || process.argv.length > 4)
  throw new Error('用法：node scripts/release/keygen.mjs <keyId> <私钥输出路径>');
if (!isKeyId(keyId)) throw new Error('keyId 只能用字母、数字、点、下划线与连字符，最长 64 个字符');

const target = resolve(output);
const repository = fileURLToPath(new URL('../..', import.meta.url));
// 不同盘符时 relative 返回目标的绝对路径，同样算在仓库之外。
const inside = relative(repository, target);
if (!inside.startsWith('..') && !isAbsolute(inside)) throw new Error('私钥不能写进本仓库的目录');

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const spki = publicSpki(pem);
const probe = `keygen-self-check:${keyId}`;
if (!(await verifySignature(spki, probe, signPayload(pem, probe))))
  throw new Error('新密钥未通过客户端验签');

writeFileSync(target, pem, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ keyId, spki }));
