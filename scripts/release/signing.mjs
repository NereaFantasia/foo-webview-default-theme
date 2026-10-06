// 根清单的签名一侧。参数与客户端验签一一对应，发出去以后不能改：ECDSA P-256、SHA-256，签名对象是
// payload 字符串的 UTF-8 字节，签名为 IEEE P1363（r、s 各 32 字节）的标准 Base64，公钥为 SPKI DER 的
// 标准 Base64。Node 的 crypto.sign 默认输出 DER，客户端的 WebCrypto 验不过，必须显式要 ieee-p1363。

import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { verifySignature } from '../../src/update/rootTrust.ts';
import { SIGNATURE_VECTORS } from './signature-vectors.mjs';

/** @param {string} privateKeyPem */
function p256(privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('签名私钥必须是 P-256 的 EC 私钥');
  return key;
}

/** @param {string} privateKeyPem PKCS#8 PEM @param {string} payload */
export function signPayload(privateKeyPem, payload) {
  return sign('sha256', Buffer.from(payload, 'utf8'), {
    key: p256(privateKeyPem),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
}

/** @param {string} privateKeyPem */
export function publicSpki(privateKeyPem) {
  return createPublicKey(p256(privateKeyPem))
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
}

/**
 * 签名信封：可以有多个签名，客户端只要有一个能被它信任的公钥验过就接受。每个签名都先用客户端
 * 的验签代码核对一遍，签出客户端不认的格式时直接失败，不发布。
 * @param {string} payload
 * @param {{ keyId: string, privateKeyPem: string }[]} signers
 */
export async function signEnvelope(payload, signers) {
  if (!signers.length) throw new Error('至少要有一个签名');
  const signatures = [];
  for (const { keyId, privateKeyPem } of signers) {
    const sig = signPayload(privateKeyPem, payload);
    if (!(await verifySignature(publicSpki(privateKeyPem), payload, sig)))
      throw new Error(`签名 ${keyId} 未通过客户端验签`);
    signatures.push({ keyId, sig });
  }
  return JSON.stringify({ payload, signatures }, null, 2) + '\n';
}

/** 发版脚本开工前先核对固定测试向量，确认验签参数没有被改动。 */
export async function checkVectors() {
  const vectors = SIGNATURE_VECTORS;
  if (!(await verifySignature(vectors.spki, vectors.payload, vectors.signature)))
    throw new Error('签名测试向量的正例没有验过');
  for (const reject of vectors.rejects)
    if (await verifySignature(vectors.spki, reject.payload, reject.signature))
      throw new Error('签名测试向量的反例被验过了');
}
