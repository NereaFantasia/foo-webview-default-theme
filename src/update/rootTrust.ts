import {
  ROOT_FORMAT,
  isBase64,
  isKeyId,
  isSha256,
  isStableVersion,
  readRootPayload,
  sha256,
  type PublishedKey,
  type RootPayload,
} from './contract.ts';

/**
 * 根清单的签名信封与信任集。签名是 ECDSA P-256 / SHA-256，对象是 payload 字符串的 UTF-8 字节，
 * 格式为 IEEE P1363（r、s 各 32 字节）的标准 Base64；公钥是 SPKI DER 的标准 Base64。
 */

export interface LearnedKey extends PublishedKey {
  /** 公布这把钥的各份根清单上，验过的签名来自哪些钥；信任只沿这些边从内置钥往下传。 */
  readonly introducedBy: readonly string[];
}
export interface RootRecord {
  readonly serial: number;
  readonly payloadSha256: string;
}
/** 序号、信任图、累计吊销与撤回表必须作为一份状态整体写入，不能只落盘其中一部分。 */
export interface TrustState {
  readonly [key: string]: unknown;
  readonly schema: 1;
  /** 按根清单格式号分开计数，格式升级后并存的几份清单互不影响。 */
  readonly roots: Readonly<Record<string, RootRecord>>;
  readonly keys: readonly LearnedKey[];
  /** 累计吊销的 keyId；后来的清单省略它也不会重新启用。 */
  readonly revokedKeys: readonly string[];
  /** 最近一次接受的根清单里的撤回表。 */
  readonly revoked: readonly string[];
}
export const INITIAL_TRUST: TrustState = {
  schema: 1,
  roots: {},
  keys: [],
  revokedKeys: [],
  revoked: [],
};

export type RootDecision =
  | { readonly kind: 'accepted'; readonly state: TrustState; readonly payload: RootPayload }
  /** 不是签名信封：认证门户、劫持或截断的响应，按暂时性失败处理。 */
  | { readonly kind: 'malformed' }
  /** 没有一个签名能被已信任的公钥验过。 */
  | { readonly kind: 'unverified' }
  /** 签名有效，但内容不合契约或试图改绑、复活公钥。 */
  | { readonly kind: 'invalid' }
  /** 序号小于见过的最大值，或同一序号换了内容；可能是重放，也可能是 CDN 节点不同步。 */
  | { readonly kind: 'stale' }
  | { readonly kind: 'manual'; readonly reason: 'format' | 'updater' | 'trust' };

interface Envelope {
  readonly payload: string;
  readonly signatures: readonly { readonly keyId: string; readonly sig: string }[];
}

const MAX_PAYLOAD = 1024 * 1024;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function decode(text: string): Uint8Array<ArrayBuffer> | null {
  return isBase64(text) ? Uint8Array.from(atob(text), (char) => char.charCodeAt(0)) : null;
}
function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function readEnvelope(text: string): Envelope | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !record(value) ||
    typeof value.payload !== 'string' ||
    value.payload.length > MAX_PAYLOAD ||
    !Array.isArray(value.signatures) ||
    value.signatures.length > 16
  )
    return null;
  const signatures: { keyId: string; sig: string }[] = [];
  for (const item of value.signatures) {
    if (!record(item) || !isKeyId(item.keyId) || typeof item.sig !== 'string') return null;
    signatures.push({ keyId: item.keyId, sig: item.sig });
  }
  return { payload: value.payload, signatures };
}

async function publicKey(spki: string): Promise<CryptoKey | null> {
  const der = decode(spki);
  if (!der) return null;
  try {
    return await crypto.subtle.importKey('spki', der, ECDSA, false, ['verify']);
  } catch {
    return null;
  }
}

/** 只接受 64 字节的 P1363 签名；Node 默认输出的 DER 签名长度不同，在这里就验不过。 */
export async function verifySignature(
  spki: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const bytes = decode(signature);
  const key = await publicKey(spki);
  if (!bytes || bytes.length !== 64 || !key) return false;
  try {
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      bytes,
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

/** 从未吊销的内置钥出发，沿引入边能到达的钥才可信；与内置钥断开的自签或互签不算。 */
function trustedKeys(state: TrustState, builtIn: readonly PublishedKey[]): Map<string, string> {
  const revoked = new Set(state.revokedKeys);
  const reached = new Map(
    builtIn.filter((key) => !revoked.has(key.keyId)).map((key) => [key.keyId, key.spki]),
  );
  for (let grew = true; grew;) {
    grew = false;
    for (const key of state.keys) {
      if (reached.has(key.keyId) || revoked.has(key.keyId)) continue;
      if (key.introducedBy.some((id) => reached.has(id))) {
        reached.set(key.keyId, key.spki);
        grew = true;
      }
    }
  }
  return reached;
}

/**
 * 验签并算出接受这份根清单之后的状态。验签只用接受之前已信任的钥，清单新公布的钥不能为自己
 * 背书；同一个 keyId 永久绑定同一个公钥。返回 accepted 时调用方先原子写入新状态，写成之后才
 * 按清单选版本或下载；其余结果都不改变已接受的状态。
 */
export async function acceptRoot(
  state: TrustState,
  text: string,
  builtIn: readonly PublishedKey[],
): Promise<RootDecision> {
  const envelope = readEnvelope(text);
  if (!envelope) return { kind: 'malformed' };
  const trusted = trustedKeys(state, builtIn);
  const signers = new Set<string>();
  for (const { keyId, sig } of envelope.signatures) {
    const spki = trusted.get(keyId);
    if (spki && !signers.has(keyId) && (await verifySignature(spki, envelope.payload, sig)))
      signers.add(keyId);
  }
  if (!signers.size) return { kind: 'unverified' };

  const reading = readRootPayload(envelope.payload);
  if (reading.kind === 'manual') return reading;
  if (reading.kind === 'invalid') return { kind: 'invalid' };
  const payload = reading.payload;
  const payloadSha256 = await sha256(new TextEncoder().encode(envelope.payload));
  const seen = state.roots[String(ROOT_FORMAT)];
  if (
    seen &&
    (payload.serial < seen.serial ||
      (payload.serial === seen.serial && payloadSha256 !== seen.payloadSha256))
  )
    return { kind: 'stale' };

  const revokedKeys = unique([...state.revokedKeys, ...payload.revokedKeys]);
  const keys = [...state.keys];
  for (const published of payload.keys) {
    if (revokedKeys.includes(published.keyId)) return { kind: 'invalid' };
    const fixed = builtIn.find((key) => key.keyId === published.keyId);
    const at = keys.findIndex((key) => key.keyId === published.keyId);
    const bound = fixed ?? keys[at];
    if (bound && bound.spki !== published.spki) return { kind: 'invalid' };
    if (fixed) continue;
    const learned = keys[at];
    if (learned) {
      keys[at] = { ...learned, introducedBy: unique([...learned.introducedBy, ...signers]) };
      continue;
    }
    if (!(await publicKey(published.spki))) return { kind: 'invalid' };
    keys.push({ ...published, introducedBy: unique([...signers]) });
  }

  const next: TrustState = {
    ...state,
    schema: 1,
    roots: { ...state.roots, [String(ROOT_FORMAT)]: { serial: payload.serial, payloadSha256 } },
    keys,
    revokedKeys,
    revoked: payload.revoked,
  };
  const remaining = trustedKeys(next, builtIn);
  if (![...signers].some((id) => remaining.has(id))) return { kind: 'manual', reason: 'trust' };
  return { kind: 'accepted', state: next, payload };
}

function strings(value: unknown, valid: (item: unknown) => item is string): string[] | null {
  return Array.isArray(value) && value.every(valid) ? [...value] : null;
}

/** 状态文件损坏时返回 null；调用方要停下自动更新，不能当作初始状态重新学钥。 */
export function readTrustState(value: unknown): TrustState | null {
  if (!record(value) || value.schema !== 1 || !record(value.roots) || !Array.isArray(value.keys))
    return null;
  const roots: Record<string, RootRecord> = {};
  for (const [format, item] of Object.entries(value.roots)) {
    if (
      !/^[1-9]\d{0,3}$/.test(format) ||
      !record(item) ||
      typeof item.serial !== 'number' ||
      !Number.isSafeInteger(item.serial) ||
      item.serial < 0 ||
      !isSha256(item.payloadSha256)
    )
      return null;
    roots[format] = { serial: item.serial, payloadSha256: item.payloadSha256 };
  }
  const keys: LearnedKey[] = [];
  for (const item of value.keys) {
    const introducedBy = record(item) ? strings(item.introducedBy, isKeyId) : null;
    if (
      !record(item) ||
      !isKeyId(item.keyId) ||
      !isBase64(item.spki) ||
      !introducedBy ||
      keys.some((key) => key.keyId === item.keyId)
    )
      return null;
    keys.push({ keyId: item.keyId, spki: item.spki, introducedBy });
  }
  const revokedKeys = strings(value.revokedKeys, isKeyId);
  const revoked = strings(value.revoked, isStableVersion);
  if (!revokedKeys || !revoked) return null;
  return { ...value, schema: 1, roots, keys, revokedKeys, revoked };
}
