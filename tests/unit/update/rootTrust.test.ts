import { describe, expect, it } from 'vitest';
import { SIGNATURE_VECTORS as vectors } from '../../../scripts/release/signature-vectors.mjs';
import {
  publishedKey as key,
  rootPayload as payload,
  rootSigner as signer,
  signRoot as envelope,
} from '../../fixtures/rootSigning.ts';
import type { PublishedKey } from '../../../src/update/contract.ts';
import {
  INITIAL_TRUST,
  acceptRoot,
  readTrustState,
  verifySignature,
  type TrustState,
} from '../../../src/update/rootTrust.ts';

async function accepted(
  state: TrustState,
  text: string,
  builtIn: readonly PublishedKey[],
): Promise<TrustState> {
  const decision = await acceptRoot(state, text, builtIn);
  if (decision.kind !== 'accepted') throw new Error(`没有接受：${decision.kind}`);
  return decision.state;
}

describe('verifySignature', () => {
  it('固定向量的正例验过，篡改与 DER 格式的反例验不过', async () => {
    expect(await verifySignature(vectors.spki, vectors.payload, vectors.signature)).toBe(true);
    for (const reject of vectors.rejects)
      expect(await verifySignature(vectors.spki, reject.payload, reject.signature)).toBe(false);
  });

  it('公钥或签名不是合法 Base64 时验不过', async () => {
    expect(await verifySignature('AAAA', vectors.payload, vectors.signature)).toBe(false);
    expect(await verifySignature(vectors.spki, vectors.payload, '***')).toBe(false);
  });
});

describe('acceptRoot', () => {
  it('内置钥签名的清单被接受，记下序号、payload 哈希与撤回表', async () => {
    const a = await signer('a');
    const text = payload(5, { revoked: ['0.1.1'] });
    const decision = await acceptRoot(INITIAL_TRUST, await envelope(text, [a]), [key(a)]);
    expect(decision.kind).toBe('accepted');
    if (decision.kind !== 'accepted') return;
    expect(decision.state.roots['1']?.serial).toBe(5);
    expect(decision.state.roots['1']?.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(decision.state.revoked).toEqual(['0.1.1']);
    expect(decision.payload.serial).toBe(5);
  });

  it('多个签名里只要有一个可信就接受', async () => {
    const [a, stranger] = await Promise.all([signer('a'), signer('stranger')]);
    const text = await envelope(payload(1), [stranger, a]);
    expect((await acceptRoot(INITIAL_TRUST, text, [key(a)])).kind).toBe('accepted');
  });

  it('不是签名信封、没有可信签名时分别报告', async () => {
    const [a, stranger] = await Promise.all([signer('a'), signer('stranger')]);
    expect((await acceptRoot(INITIAL_TRUST, '<html>认证</html>', [key(a)])).kind).toBe('malformed');
    expect(
      (await acceptRoot(INITIAL_TRUST, JSON.stringify({ payload: 1, signatures: [] }), [key(a)]))
        .kind,
    ).toBe('malformed');
    const text = await envelope(payload(1), [stranger]);
    expect((await acceptRoot(INITIAL_TRUST, text, [key(a)])).kind).toBe('unverified');
    const forged = JSON.stringify({ ...JSON.parse(text), signatures: [{ keyId: 'a', sig: '' }] });
    expect((await acceptRoot(INITIAL_TRUST, forged, [key(a)])).kind).toBe('unverified');
  });

  it('签名有效但格式或更新器要求读不懂时转为手动更新', async () => {
    const a = await signer('a');
    expect(
      await acceptRoot(INITIAL_TRUST, await envelope(JSON.stringify({ format: 2 }), [a]), [key(a)]),
    ).toEqual({ kind: 'manual', reason: 'format' });
    expect(
      await acceptRoot(INITIAL_TRUST, await envelope(payload(1, { minUpdater: 9 }), [a]), [key(a)]),
    ).toEqual({ kind: 'manual', reason: 'updater' });
    expect((await acceptRoot(INITIAL_TRUST, await envelope(payload(-1), [a]), [key(a)])).kind).toBe(
      'invalid',
    );
  });

  it('序号倒退或同号换内容时拒收，同号同内容照常接受', async () => {
    const a = await signer('a');
    const state = await accepted(INITIAL_TRUST, await envelope(payload(10), [a]), [key(a)]);
    expect((await acceptRoot(state, await envelope(payload(9), [a]), [key(a)])).kind).toBe('stale');
    const changed = payload(10, { revoked: ['0.2.0'] });
    expect((await acceptRoot(state, await envelope(changed, [a]), [key(a)])).kind).toBe('stale');
    expect(await accepted(state, await envelope(payload(10), [a]), [key(a)])).toEqual(state);
  });

  it('从已信任的清单学到新钥，之后可单独用新钥签名', async () => {
    const [a, b] = await Promise.all([signer('a'), signer('b')]);
    const learned = await accepted(
      INITIAL_TRUST,
      await envelope(payload(1, { keys: [key(b)] }), [a]),
      [key(a)],
    );
    expect(learned.keys).toEqual([{ ...key(b), introducedBy: ['a'] }]);
    expect((await acceptRoot(learned, await envelope(payload(2), [b]), [key(a)])).kind).toBe(
      'accepted',
    );
  });

  it('新公布的钥不能为自己背书', async () => {
    const [a, b] = await Promise.all([signer('a'), signer('b')]);
    const text = await envelope(payload(1, { keys: [key(b)] }), [b]);
    expect((await acceptRoot(INITIAL_TRUST, text, [key(a)])).kind).toBe('unverified');
  });

  it('同一 keyId 换公钥、被吊销的 id 再出现、公钥导入不了时整份拒收', async () => {
    const [a, b, other] = await Promise.all([signer('a'), signer('b'), signer('other')]);
    const learned = await accepted(
      INITIAL_TRUST,
      await envelope(payload(1, { keys: [key(b)] }), [a]),
      [key(a)],
    );
    const rebind = payload(2, { keys: [{ keyId: 'b', spki: other.spki }] });
    expect((await acceptRoot(learned, await envelope(rebind, [a]), [key(a)])).kind).toBe('invalid');
    const builtInRebind = payload(2, { keys: [{ keyId: 'a', spki: other.spki }] });
    expect((await acceptRoot(learned, await envelope(builtInRebind, [a]), [key(a)])).kind).toBe(
      'invalid',
    );
    const revoked = await accepted(
      learned,
      await envelope(payload(2, { revokedKeys: ['b'] }), [a]),
      [key(a)],
    );
    const revive = payload(3, { keys: [key(b)] });
    expect((await acceptRoot(revoked, await envelope(revive, [a]), [key(a)])).kind).toBe('invalid');
    const broken = payload(3, { keys: [{ keyId: 'c', spki: 'AAAA' }] });
    expect((await acceptRoot(revoked, await envelope(broken, [a]), [key(a)])).kind).toBe('invalid');
  });

  it('吊销后与内置钥断开的钥一并停用，自签与互相引入不能保活', async () => {
    const [a, z, b, c] = await Promise.all([signer('a'), signer('z'), signer('b'), signer('c')]);
    const builtIn = [key(a), key(z)];
    let state = await accepted(
      INITIAL_TRUST,
      await envelope(payload(1, { keys: [key(b)] }), [a]),
      builtIn,
    );
    state = await accepted(
      state,
      await envelope(payload(2, { keys: [key(b), key(c)] }), [b]),
      builtIn,
    );
    state = await accepted(state, await envelope(payload(3, { keys: [key(b)] }), [c]), builtIn);
    expect(state.keys.find((item) => item.keyId === 'b')?.introducedBy).toEqual(['a', 'b', 'c']);
    state = await accepted(
      state,
      await envelope(payload(4, { revokedKeys: ['a'] }), [a, z]),
      builtIn,
    );
    for (const orphan of [b, c])
      expect((await acceptRoot(state, await envelope(payload(5), [orphan]), builtIn)).kind).toBe(
        'unverified',
      );
    expect(state.keys.map((item) => item.keyId)).toEqual(['b', 'c']);
    expect((await acceptRoot(state, await envelope(payload(5), [z]), builtIn)).kind).toBe(
      'accepted',
    );
  });

  it('吊销后原先验过的签名都失去可信根时要求手动更新', async () => {
    const [a, b] = await Promise.all([signer('a'), signer('b')]);
    const state = await accepted(
      INITIAL_TRUST,
      await envelope(payload(1, { keys: [key(b)] }), [a]),
      [key(a)],
    );
    expect(
      await acceptRoot(state, await envelope(payload(2, { revokedKeys: ['a'] }), [a, b]), [key(a)]),
    ).toEqual({ kind: 'manual', reason: 'trust' });
  });

  it('跨两代换钥后，长期没升级的客户端靠旧钥的多签仍能接受最新清单', async () => {
    const [a, c] = await Promise.all([signer('a'), signer('c')]);
    const latest = payload(50, {
      channels: {
        stable: [
          {
            version: '0.9.0',
            stone: true,
            upgradeFrom: '>=0.1.0',
            requires: {},
            requiresLoader: 1,
            release: 'https://cnb.cool/x/release.json',
            releaseSha256: 'c'.repeat(64),
          },
        ],
      },
    });
    const decision = await acceptRoot(INITIAL_TRUST, await envelope(latest, [c, a]), [key(a)]);
    expect(decision.kind === 'accepted' && decision.payload.stable[0]?.stone).toBe(true);
  });
});

describe('readTrustState', () => {
  it('读回写出的状态，并保留以后版本加的字段', async () => {
    const [a, b] = await Promise.all([signer('a'), signer('b')]);
    const state = await accepted(
      INITIAL_TRUST,
      await envelope(payload(1, { keys: [key(b)], revokedKeys: ['old'] }), [a]),
      [key(a)],
    );
    const stored = JSON.parse(JSON.stringify({ ...state, later: { x: 1 } }));
    expect(readTrustState(stored)).toEqual({ ...state, later: { x: 1 } });
  });

  it('损坏时返回 null，不当作初始状态', () => {
    for (const bad of [
      null,
      { ...INITIAL_TRUST, schema: 2 },
      { ...INITIAL_TRUST, roots: { '1': { serial: -1, payloadSha256: 'a'.repeat(64) } } },
      { ...INITIAL_TRUST, roots: { x: { serial: 1, payloadSha256: 'a'.repeat(64) } } },
      { ...INITIAL_TRUST, keys: [{ keyId: 'b', spki: 'AAAA' }] },
      {
        ...INITIAL_TRUST,
        keys: [
          { keyId: 'b', spki: 'AAAA', introducedBy: [] },
          { keyId: 'b', spki: 'AAAA', introducedBy: [] },
        ],
      },
      { ...INITIAL_TRUST, revokedKeys: undefined },
      { ...INITIAL_TRUST, revoked: ['1.0'] },
    ])
      expect(readTrustState(bad)).toBeNull();
  });
});
