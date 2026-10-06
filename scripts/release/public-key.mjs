// 从根清单签名私钥算出对应的公钥。公钥不用另外申请，由私钥在本地推出；这里只打印 keyId 与 SPKI，
// 不输出私钥内容。私钥必须是 P-256，算出的公钥先用客户端的验签代码核对一遍。
//
// 用法：node scripts/release/public-key.mjs <keyId> <私钥路径>

import { readFileSync } from 'node:fs';
import { isKeyId } from '../../src/update/contract.ts';
import { verifySignature } from '../../src/update/rootTrust.ts';
import { publicSpki, signPayload } from './signing.mjs';

const [keyId, path] = process.argv.slice(2);
if (!keyId || !path || process.argv.length > 4)
  throw new Error('用法：node scripts/release/public-key.mjs <keyId> <私钥路径>');
if (!isKeyId(keyId)) throw new Error('keyId 只能用字母、数字、点、下划线与连字符，最长 64 个字符');

const pem = readFileSync(path, 'utf8');
const spki = publicSpki(pem);
const probe = `public-key-self-check:${keyId}`;
if (!(await verifySignature(spki, probe, signPayload(pem, probe))))
  throw new Error('这把私钥签出的签名没有通过客户端验签');
console.log(JSON.stringify({ keyId, spki }));
