import type { PublishedKey } from '../../src/update/contract.ts';

/** 测试用的根清单签名者：WebCrypto 生成的 P-256 钥，签名本来就是 P1363 格式。 */
export interface RootSigner {
  readonly keyId: string;
  readonly spki: string;
  readonly privateKey: CryptoKey;
}

function base64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export async function rootSigner(keyId: string): Promise<RootSigner> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  return {
    keyId,
    spki: base64(await crypto.subtle.exportKey('spki', pair.publicKey)),
    privateKey: pair.privateKey,
  };
}

export function publishedKey({ keyId, spki }: RootSigner): PublishedKey {
  return { keyId, spki };
}

/** 第 1 版根清单的 payload 文本；`fields` 覆盖或补充字段。 */
export function rootPayload(serial: number, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: 1, serial, minUpdater: 1, channels: { stable: [] }, ...fields });
}

export async function signRoot(text: string, signers: readonly RootSigner[]): Promise<string> {
  const signatures = [];
  for (const signer of signers) {
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      signer.privateKey,
      new TextEncoder().encode(text),
    );
    signatures.push({ keyId: signer.keyId, sig: base64(sig) });
  }
  return JSON.stringify({ payload: text, signatures });
}
