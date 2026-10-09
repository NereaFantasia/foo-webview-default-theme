import { describe, expect, it } from 'vitest';
import { readRootPayload, type Candidate } from '../../../src/update/contract.ts';
import { selectRelease, type SelectionContext } from '../../../src/update/releaseSelection.ts';

const CURRENT: SelectionContext = {
  current: '0.1.0',
  plugin: '2.0.0',
  loader: 1,
  revoked: [],
  failed: [],
};

function candidate(version: string, fields: Partial<Candidate> = {}): Candidate {
  return {
    version,
    stone: false,
    upgradeFrom: '>=0.1.0',
    requires: { foo_ui_webview2: '>=2.0.0' },
    requiresLoader: 1,
    release: `https://example.com/${version}/release.json`,
    releaseSha256: 'a'.repeat(64),
    ...fields,
  };
}

function read(candidates: Candidate[], fields: Record<string, unknown> = {}) {
  return readRootPayload(
    JSON.stringify({
      format: 1,
      serial: 1,
      minUpdater: 1,
      channels: { stable: candidates },
      ...fields,
    }),
  );
}

describe('跨版本升级路径', () => {
  it('过渡主题确认后仍等插件实际升级，不把主题版本变化当作插件已经更新', () => {
    const bridge = candidate('0.1.5', { stone: true });
    const target = candidate('0.2.0', {
      upgradeFrom: '>=0.1.5',
      requires: { foo_ui_webview2: '>=2.1.0' },
    });
    const releases = [target, bridge];
    expect(selectRelease(releases, CURRENT)).toMatchObject({
      kind: 'install',
      candidate: { version: '0.1.5' },
      limit: 'plugin',
    });
    const afterBridge = { ...CURRENT, current: '0.1.5' };
    expect(selectRelease(releases, afterBridge)).toEqual({
      kind: 'blocked',
      latest: '0.2.0',
      limit: 'plugin',
      pluginRange: '>=2.1.0',
    });
    expect(selectRelease(releases, { ...afterBridge, plugin: '2.1.0' })).toMatchObject({
      kind: 'install',
      candidate: { version: '0.2.0' },
      limit: null,
    });
  });

  it('提高根清单更新器要求会阻止读取整组候选，包括原本可安装的过渡版', () => {
    expect(read([candidate('0.1.5')], { minUpdater: 2 })).toEqual({
      kind: 'manual',
      reason: 'updater',
    });
  });

  it('不认识的组件目录不影响旧格式的前端升级', () => {
    const reading = read([candidate('0.1.5')], {
      componentCatalog: { format: 99, url: 'https://example.com/components.json' },
    });
    expect(reading.kind).toBe('ok');
    if (reading.kind !== 'ok') return;
    expect(selectRelease(reading.payload.stable, CURRENT)).toMatchObject({
      kind: 'install',
      candidate: { version: '0.1.5' },
    });
  });

  it('标记过渡版不会强迫可直升的用户先安装它', () => {
    const releases = [candidate('0.2.0'), candidate('0.1.5', { stone: true })];
    expect(selectRelease(releases, CURRENT)).toMatchObject({
      kind: 'install',
      candidate: { version: '0.2.0' },
    });
  });

  it('过渡版落在候选上限之外时不可达，放回可见范围后才能选中', () => {
    const blocked = Array.from({ length: 256 }, (_, at) =>
      candidate(`0.2.${at}`, { upgradeFrom: '>=0.1.5' }),
    );
    const bridge = candidate('0.1.5', { stone: true });
    const hidden = read([...blocked, bridge]);
    const visible = read([bridge, ...blocked]);
    expect(hidden.kind).toBe('ok');
    expect(visible.kind).toBe('ok');
    if (hidden.kind !== 'ok' || visible.kind !== 'ok') return;
    expect(selectRelease(hidden.payload.stable, CURRENT)).toMatchObject({
      kind: 'blocked',
      limit: 'stone',
    });
    expect(selectRelease(visible.payload.stable, CURRENT)).toMatchObject({
      kind: 'install',
      candidate: { version: '0.1.5' },
    });
  });

  it('过渡版被撤回后停止，不绕过目标版本的直升要求', () => {
    const releases = [
      candidate('0.2.0', { upgradeFrom: '>=0.1.5' }),
      candidate('0.1.5', { stone: true }),
    ];
    expect(selectRelease(releases, { ...CURRENT, revoked: ['0.1.5'] })).toMatchObject({
      kind: 'blocked',
      limit: 'stone',
    });
  });
});
