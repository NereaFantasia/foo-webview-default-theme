import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  checkVectors,
  publicSpki,
  signEnvelope,
  signPayload,
} from '../../scripts/release/signing.mjs';
import { INITIAL_TRUST, acceptRoot, verifySignature } from '../../src/update/rootTrust.ts';

function pem(namedCurve = 'prime256v1'): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

describe('根清单签名', () => {
  it('固定测试向量在发版端同样验过', async () => {
    await expect(checkVectors()).resolves.toBeUndefined();
  });

  it('签出 64 字节的 P1363 签名，客户端验得过，含中文的 payload 按 UTF-8 签', async () => {
    const key = pem();
    const payload = '{"note":"中文"}';
    const signature = signPayload(key, payload);
    expect(Buffer.from(signature, 'base64')).toHaveLength(64);
    expect(await verifySignature(publicSpki(key), payload, signature)).toBe(true);
  });

  it('签名信封被客户端接受', async () => {
    const key = pem();
    const payload = JSON.stringify({ format: 1, serial: 1, minUpdater: 1, channels: {} });
    const text = await signEnvelope(payload, [{ keyId: 'k1', privateKeyPem: key }]);
    const decision = await acceptRoot(INITIAL_TRUST, text, [
      { keyId: 'k1', spki: publicSpki(key) },
    ]);
    expect(decision.kind).toBe('accepted');
  });

  it('拒绝非 P-256 的私钥与空签名列表', async () => {
    expect(() => signPayload(pem('secp384r1'), 'x')).toThrow('P-256');
    await expect(signEnvelope('x', [])).rejects.toThrow('至少');
  });

  it('从私钥文件导出的公钥与签名模块算出的一致，私钥内容不输出', () => {
    const work = mkdtempSync(join(tmpdir(), 'public-key-'));
    onTestFinished(() => rmSync(work, { recursive: true, force: true }));
    const key = pem();
    writeFileSync(join(work, 'key.pem'), key);
    const script = fileURLToPath(new URL('../../scripts/release/public-key.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, 'k1', join(work, 'key.pem')], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ keyId: 'k1', spki: publicSpki(key) });
    expect(result.stdout).not.toContain('PRIVATE KEY');
  });
});
