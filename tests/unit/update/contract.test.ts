import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_KEYS,
  compareVersions,
  readRelease,
  readRootPayload,
  satisfies,
  sha256,
  type Candidate,
} from '../../../src/update/contract.ts';

const SHA = 'b'.repeat(64);
const CANDIDATE = {
  version: '0.2.0',
  upgradeFrom: '>=0.1.0',
  requires: { foo_ui_webview2: '>=2.0.0' },
  requiresLoader: 1,
  release: 'https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/v0.2.0/release.json',
  releaseSha256: SHA,
};
function root(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 1,
    serial: 3,
    minUpdater: 1,
    channels: { stable: [CANDIDATE] },
    revoked: [],
    keys: [],
    revokedKeys: [],
    ...fields,
  });
}

describe('compareVersions', () => {
  it('按语义化版本的优先级排序，预发布低于同号正式版', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.10.0',
      '2.0.0',
    ];
    for (let at = 1; at < ordered.length; at += 1) {
      expect(compareVersions(ordered[at - 1]!, ordered[at]!)).toBe(-1);
      expect(compareVersions(ordered[at]!, ordered[at - 1]!)).toBe(1);
    }
  });

  it('构建元数据不参与比较', () => {
    expect(compareVersions('2.0.0+abc', '2.0.0')).toBe(0);
  });

  it('读不出版本号时返回 null', () => {
    for (const bad of ['1.0', '01.0.0', 'v1.0.0', '1.0.0-', '1.0.0-01', ''])
      expect(compareVersions(bad, '1.0.0')).toBeNull();
  });
});

describe('satisfies', () => {
  it('只认 >=X.Y.Z 一种写法', () => {
    expect(satisfies('2.0.0', '>=2.0.0')).toBe(true);
    expect(satisfies('2.1.0-beta.1', '>=2.0.0')).toBe(true);
    expect(satisfies('2.0.0-beta.1', '>=2.0.0')).toBe(false);
    expect(satisfies('2.0.0', '>2.0.0')).toBe(false);
    expect(satisfies('2.0.0', '>=2.0')).toBe(false);
    expect(satisfies('2.0.0', '>=2.0.0-beta')).toBe(false);
    expect(satisfies('不是版本', '>=1.0.0')).toBe(false);
  });
});

describe('readRootPayload', () => {
  it('读出稳定渠道的候选，缺省的列表按空处理', () => {
    const reading = readRootPayload(
      JSON.stringify({ format: 1, serial: 0, minUpdater: 1, channels: { stable: [CANDIDATE] } }),
    );
    expect(reading).toEqual({
      kind: 'ok',
      payload: {
        format: 1,
        serial: 0,
        minUpdater: 1,
        stable: [{ ...CANDIDATE, stone: false }],
        revoked: [],
        keys: [],
        revokedKeys: [],
        changelog: null,
        plugins: [],
      },
    });
  });

  it('读出插件候选，读不懂的丢掉这一个', () => {
    const plugin = {
      version: '2.1.0',
      arch: 'x64',
      url: 'https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/v2.1.0/plugin.json',
      size: 1024,
      sha256: SHA,
    };
    const read = (value: unknown) => {
      const reading = readRootPayload(root({ plugins: value }));
      return reading.kind === 'ok' ? reading.payload.plugins : 'invalid';
    };
    expect(read(undefined)).toEqual([]);
    expect(read([plugin])).toEqual([plugin]);
    expect(
      read([plugin, { ...plugin, arch: 'arm64' }, { ...plugin, version: '2.1' }, '不是对象']),
    ).toEqual([plugin]);
    expect(read('不是数组')).toEqual([]);
  });

  it('读出更新日志附件，写错时当作没有，不连累整份清单', () => {
    const changelog = {
      url: 'https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/v0.2.0/changelog.json',
      size: 2048,
      sha256: SHA,
    };
    const read = (value: unknown) => {
      const reading = readRootPayload(root({ changelog: value }));
      return reading.kind === 'ok' ? reading.payload.changelog : 'invalid';
    };
    expect(read(changelog)).toEqual(changelog);
    for (const bad of [
      { ...changelog, url: 'http://cnb.cool/changelog.json' },
      { ...changelog, size: 0 },
      { ...changelog, size: 2 * 1024 * 1024 },
      { ...changelog, sha256: 'x' },
      '不是对象',
    ])
      expect(read(bad)).toBeNull();
  });

  it('格式与更新器要求先于其余字段判断', () => {
    expect(readRootPayload(JSON.stringify({ format: 2 }))).toEqual({
      kind: 'manual',
      reason: 'format',
    });
    expect(readRootPayload(root({ minUpdater: 2, serial: 'x' }))).toEqual({
      kind: 'manual',
      reason: 'updater',
    });
  });

  it('只丢掉格式不对的候选，其他渠道不解析', () => {
    const reading = readRootPayload(
      root({
        channels: {
          stable: [
            { ...CANDIDATE, upgradeFrom: '>=1.0' },
            { ...CANDIDATE, version: '0.3.0' },
          ],
          beta: '以后的渠道',
        },
      }),
    );
    expect(reading.kind === 'ok' && reading.payload.stable.map((item) => item.version)).toEqual([
      '0.3.0',
    ]);
  });

  it('影响信任与撤回的字段写错时整份作废', () => {
    for (const fields of [
      { serial: -1 },
      { serial: 1.5 },
      { channels: [] },
      { revoked: ['1.0'] },
      { revokedKeys: ['带空格 的 id'] },
      { keys: [{ keyId: 'a', spki: '不是 base64' }] },
      {
        keys: [
          { keyId: 'a', spki: 'AAAA' },
          { keyId: 'a', spki: 'BBBB' },
        ],
      },
      { minUpdater: 0 },
    ])
      expect(readRootPayload(root(fields))).toEqual({ kind: 'invalid' });
    expect(readRootPayload('<html>登录</html>')).toEqual({ kind: 'invalid' });
  });
});

describe('readRelease', () => {
  const expected: Candidate = { ...CANDIDATE, stone: false };
  const release = (fields: Record<string, unknown> = {}) =>
    JSON.stringify({
      format: 1,
      version: '0.2.0',
      upgradeFrom: '>=0.1.0',
      requires: { foo_ui_webview2: '>=2.0.0' },
      requiresLoader: 1,
      notes: { 'zh-CN': '修复', en: 'Fixes', bad: 3 },
      components: {
        frontend: { url: 'https://cnb.cool/x/fe-0.2.0.zip', size: 1000, sha256: SHA },
        backend: { url: 'https://cnb.cool/x/be-0.2.0.zip', size: 1, sha256: SHA },
      },
      ...fields,
    });

  it('读出前端组件，其余组件与非文本的说明忽略', () => {
    expect(readRelease(release(), expected)).toEqual({
      version: '0.2.0',
      upgradeFrom: '>=0.1.0',
      requires: { foo_ui_webview2: '>=2.0.0' },
      requiresLoader: 1,
      notes: { 'zh-CN': '修复', en: 'Fixes' },
      frontend: { url: 'https://cnb.cool/x/fe-0.2.0.zip', size: 1000, sha256: SHA },
    });
  });

  it('与根清单里的候选不一致时按损坏处理', () => {
    expect(readRelease(release({ version: '0.2.1' }), expected)).toBeNull();
    expect(readRelease(release({ upgradeFrom: '>=0.0.1' }), expected)).toBeNull();
    expect(readRelease(release({ requiresLoader: 2 }), expected)).toBeNull();
    expect(readRelease(release({ requires: {} }), expected)).toBeNull();
    const twoNeeds = { ...expected, requires: { foo_ui_webview2: '>=2.0.0', other: '>=1.0.0' } };
    expect(
      readRelease(
        release({ requires: { other: '>=1.0.0', foo_ui_webview2: '>=2.0.0' } }),
        twoNeeds,
      ),
    ).not.toBeNull();
  });

  it('前端组件的地址、大小或哈希不合规时作废', () => {
    const frontend = { url: 'https://cnb.cool/x/fe.zip', size: 1000, sha256: SHA };
    for (const bad of [
      { ...frontend, url: 'http://cnb.cool/x/fe.zip' },
      { ...frontend, size: 0 },
      { ...frontend, size: 65 * 1024 * 1024 },
      { ...frontend, sha256: SHA.toUpperCase() },
    ])
      expect(readRelease(release({ components: { frontend: bad } }), expected)).toBeNull();
    expect(readRelease(release({ components: {} }), expected)).toBeNull();
  });
});

describe('sha256', () => {
  it('输出小写十六进制', async () => {
    expect(await sha256(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('BUILT_IN_KEYS', () => {
  it('内置两把不同的 P-256 公钥，WebCrypto 都能导入', async () => {
    expect(BUILT_IN_KEYS).toHaveLength(2);
    expect(new Set(BUILT_IN_KEYS.map((key) => key.keyId)).size).toBe(2);
    expect(new Set(BUILT_IN_KEYS.map((key) => key.spki)).size).toBe(2);
    for (const key of BUILT_IN_KEYS) {
      const der = Uint8Array.from(atob(key.spki), (char) => char.charCodeAt(0));
      await expect(
        crypto.subtle.importKey('spki', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
          'verify',
        ]),
      ).resolves.toBeDefined();
    }
  });
});
