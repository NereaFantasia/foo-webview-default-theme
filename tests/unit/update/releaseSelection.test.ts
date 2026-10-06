import { describe, expect, it } from 'vitest';
import type { Candidate } from '../../../src/update/contract.ts';
import { selectRelease, type SelectionContext } from '../../../src/update/releaseSelection.ts';

function candidate(version: string, fields: Partial<Candidate> = {}): Candidate {
  return {
    version,
    stone: false,
    upgradeFrom: '>=0.1.0',
    requires: { foo_ui_webview2: '>=2.0.0' },
    requiresLoader: 1,
    release: `https://cnb.cool/x/v${version}/release.json`,
    releaseSha256: version.replaceAll('.', '').padStart(64, '0'),
    ...fields,
  };
}
const CONTEXT: SelectionContext = {
  current: '0.2.0',
  plugin: '2.0.0',
  loader: 1,
  revoked: [],
  failed: [],
};

describe('selectRelease', () => {
  it('没有更高的版本时停在当前版本', () => {
    expect(selectRelease([candidate('0.2.0'), candidate('0.1.0')], CONTEXT)).toEqual({
      kind: 'current',
    });
  });

  it('不依赖列表顺序，选最高的可装版本', () => {
    const choice = selectRelease(
      [candidate('0.3.0'), candidate('0.10.0'), candidate('0.4.0')],
      CONTEXT,
    );
    expect(choice).toMatchObject({ kind: 'install', latest: '0.10.0', limit: null });
    expect(choice.kind === 'install' && choice.candidate.version).toBe('0.10.0');
  });

  it('撤回与拉黑的版本不选，拉黑按版本号加发行清单哈希认', () => {
    const top = candidate('0.5.0');
    const choice = selectRelease([top, candidate('0.4.0'), candidate('0.3.0')], {
      ...CONTEXT,
      revoked: ['0.4.0'],
      failed: [{ v: '0.5.0', releaseSha256: top.releaseSha256 }],
    });
    expect(choice).toMatchObject({ kind: 'install', latest: '0.3.0', limit: null });
    const republished = selectRelease([top], {
      ...CONTEXT,
      failed: [{ v: '0.5.0', releaseSha256: 'f'.repeat(64) }],
    });
    expect(republished).toMatchObject({ kind: 'install', latest: '0.5.0' });
  });

  it('插件版本挡住最新版时装次高的，并说明插件要求', () => {
    const choice = selectRelease(
      [candidate('0.4.0', { requires: { foo_ui_webview2: '>=2.3.0' } }), candidate('0.3.0')],
      CONTEXT,
    );
    expect(choice).toMatchObject({
      kind: 'install',
      latest: '0.4.0',
      limit: 'plugin',
      pluginRange: '>=2.3.0',
    });
    expect(choice.kind === 'install' && choice.candidate.version).toBe('0.3.0');
  });

  it('插件的预发布版本不满足同号要求', () => {
    const choice = selectRelease(
      [candidate('0.4.0', { requires: { foo_ui_webview2: '>=2.3.0' } })],
      {
        ...CONTEXT,
        plugin: '2.3.0-beta.1',
      },
    );
    expect(choice).toEqual({
      kind: 'blocked',
      latest: '0.4.0',
      limit: 'plugin',
      pluginRange: '>=2.3.0',
    });
  });

  it('upgradeFrom 够不上时先升到垫脚石', () => {
    const choice = selectRelease(
      [candidate('0.9.0', { upgradeFrom: '>=0.5.0' }), candidate('0.5.0', { stone: true })],
      CONTEXT,
    );
    expect(choice).toMatchObject({ kind: 'install', latest: '0.9.0', limit: 'stone' });
    expect(choice.kind === 'install' && choice.candidate.version).toBe('0.5.0');
  });

  it('引导页版本够不上时先升到带新引导页的垫脚石', () => {
    const choice = selectRelease(
      [candidate('0.9.0', { requiresLoader: 2 }), candidate('0.6.0', { stone: true })],
      CONTEXT,
    );
    expect(choice).toMatchObject({ kind: 'install', latest: '0.9.0', limit: 'loader' });
  });

  it('要求核对不了的组件时按手动更新处理', () => {
    expect(
      selectRelease([candidate('0.4.0', { requires: { foobar2000: '>=2.25.0' } })], CONTEXT),
    ).toEqual({ kind: 'blocked', latest: '0.4.0', limit: 'manual', pluginRange: null });
  });

  it('没有候选够得着时说明最新版被什么挡住', () => {
    expect(selectRelease([candidate('0.9.0', { upgradeFrom: '>=0.5.0' })], CONTEXT)).toEqual({
      kind: 'blocked',
      latest: '0.9.0',
      limit: 'stone',
      pluginRange: null,
    });
  });
});
