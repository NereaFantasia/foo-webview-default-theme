import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  candidateOf,
  downloadUrl,
  nextRootPayload,
  releaseManifest,
} from '../../scripts/release/manifests.mjs';
import { publishedKey, rootSigner, signRoot } from '../fixtures/rootSigning.ts';
import { readRelease, readRootPayload } from '../../src/update/contract.ts';
import { selectRelease } from '../../src/update/releaseSelection.ts';
import { INITIAL_TRUST, acceptRoot } from '../../src/update/rootTrust.ts';

const SHA = 'a'.repeat(64);
const input = (version: string) => ({
  version,
  upgradeFrom: '>=0.1.0',
  plugin: '2.0.0',
  loader: 1,
  notes: { 'zh-CN': '说明' },
  zip: { size: 100, sha256: SHA },
});
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('发行清单与根清单', () => {
  it('发行清单与候选被客户端读懂，三项要求两边一致', () => {
    const release = releaseManifest(input('0.2.0'));
    expect(release.components.frontend.url).toBe(
      'https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/v0.2.0/fe-0.2.0.zip',
    );
    expect(release.requires).toEqual({ foo_ui_webview2: '>=2.0.0' });
    const candidate = candidateOf(release, SHA);
    expect(candidate.release).toMatch(/\/v0\.2\.0\/release\.json$/);
    expect(readRelease(JSON.stringify(release), { ...candidate, stone: false })).not.toBeNull();
    expect(candidateOf(release, SHA, true)).toMatchObject({ stone: true });
  });

  it('第一份根清单从序号 1 开始；之后序号加一，同版本候选换掉，其余字段保留', () => {
    const first = nextRootPayload(null, candidateOf(releaseManifest(input('0.1.0')), SHA));
    expect(JSON.parse(first)).toMatchObject({ format: 1, serial: 1, minUpdater: 1 });
    const previous = JSON.stringify({
      ...JSON.parse(first),
      revoked: ['0.0.9'],
      keys: [{ keyId: 'k2', spki: 'AAAA' }],
      later: true,
    });
    const next = JSON.parse(
      nextRootPayload(previous, candidateOf(releaseManifest(input('0.1.0')), 'b'.repeat(64))),
    );
    expect(next).toMatchObject({ serial: 2, revoked: ['0.0.9'], later: true });
    expect(next.channels.stable).toHaveLength(1);
    expect(next.channels.stable[0].releaseSha256).toBe('b'.repeat(64));
    expect(() => nextRootPayload('{"format":2}', {})).toThrow('读不懂');
  });

  it('根清单的更新日志换成这一版的附件，不给时去掉上一份留下的', () => {
    const file = (version: string, sha256: string) => ({
      url: downloadUrl(version, 'changelog.json'),
      size: 10,
      sha256,
    });
    const first = nextRootPayload(
      null,
      candidateOf(releaseManifest(input('0.1.0')), SHA),
      file('0.1.0', SHA),
    );
    expect(readRootPayload(first)).toMatchObject({
      kind: 'ok',
      payload: { changelog: file('0.1.0', SHA) },
    });
    const second = candidateOf(releaseManifest(input('0.2.0')), SHA);
    const replaced = JSON.parse(nextRootPayload(first, second, file('0.2.0', 'b'.repeat(64))));
    expect(replaced.changelog).toEqual(file('0.2.0', 'b'.repeat(64)));
    expect(JSON.parse(nextRootPayload(first, second))).not.toHaveProperty('changelog');
  });

  it('签名后的根清单让 0.1.0 的客户端选中新版本', async () => {
    const signer = await rootSigner('k1');
    const release = releaseManifest(input('0.2.0'));
    const candidate = candidateOf(release, SHA);
    const decision = await acceptRoot(
      INITIAL_TRUST,
      await signRoot(nextRootPayload(null, candidate), [signer]),
      [publishedKey(signer)],
    );
    expect(decision.kind).toBe('accepted');
    if (decision.kind !== 'accepted') return;
    expect(
      selectRelease(decision.payload.stable, {
        current: '0.1.0',
        plugin: '2.0.0',
        loader: 1,
        revoked: [],
        failed: [],
      }),
    ).toMatchObject({ kind: 'install', latest: '0.2.0' });
    expect(readRootPayload(nextRootPayload(null, candidate)).kind).toBe('ok');
  });

  it('签名钥不是主题内置的公钥时发版脚本直接失败，不写任何分发物', () => {
    const work = mkdtempSync(join(tmpdir(), 'release-'));
    temporary.push(work);
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    writeFileSync(join(work, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const script = fileURLToPath(
      new URL('../../scripts/release/build-release.mjs', import.meta.url),
    );
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--out',
        join(work, 'out'),
        '--key',
        `stranger=${join(work, 'key.pem')}`,
        '--skip-build',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('不是主题内置的公钥');
    expect(existsSync(join(work, 'out'))).toBe(false);
  });
});
