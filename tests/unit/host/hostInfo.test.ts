import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  diagnosticsOf,
  diagnosticText,
  loadHostInfo,
  REQUIRED_HOST_VERSION,
  versionAtLeast,
} from '../../../src/host/hostInfo.ts';
import { READY_TIMEOUT_MS } from '../../../src/host/waitForHost.ts';
import { HOST_VERSION, hostFailure, isRecord } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('loadHostInfo', () => {
  it('宿主就绪时报组件版本', async () => {
    const host = installFakeHost();
    const info = await loadHostInfo(host.fb);
    expect(info).toEqual({ state: 'connected', pluginVersion: HOST_VERSION });
    expect(host.callsTo('config.getVersionInfo')).toEqual([{}]);
  });

  it('失败信封按读取失败处理', async () => {
    const host = installFakeHost();
    host.answer('config.getVersionInfo', hostFailure('OPERATION_FAILED', 'boom'));
    expect(await loadHostInfo(host.fb)).toEqual({ state: 'failed' });
  });

  it('调用抛错也按读取失败处理', async () => {
    const host = installFakeHost();
    host.answer('config.getVersionInfo', () => {
      throw new Error('bridge gone');
    });
    expect(await loadHostInfo(host.fb)).toEqual({ state: 'failed' });
  });

  it('等不到宿主时报未连接', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const pending = loadHostInfo(host.fb);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    expect(await pending).toEqual({ state: 'unavailable' });
    expect(host.calls).toEqual([]);
  });
});

describe('diagnosticText', () => {
  it('两行：fb2k 的版本与构建，组件的版本与要求的下限；不带 profile 路径', async () => {
    const host = installFakeHost();
    host.answer('config.getVersionInfo', {
      success: true,
      version: 'foobar2000 v2.24.1',
      foobar2000: 'foobar2000 v2.24.1',
      versionFull: 'foobar2000',
      is64bit: false,
      isPortable: false,
      profilePath: 'C:/Users/someone/AppData/Roaming/foobar2000-v2',
      plugin: { name: 'foo_ui_webview2', version: '1.12.3' },
    });
    const answer = await host.fb.config.getVersionInfo();
    if (answer.success === false) throw new Error('替身应答错了');
    const text = diagnosticText(diagnosticsOf(answer));
    expect(text).toBe(
      [
        'foobar2000 v2.24.1 (32-bit)',
        `foo_ui_webview2 1.12.3 (requires ${REQUIRED_HOST_VERSION} or later)`,
      ].join('\n'),
    );
    expect(text).not.toContain('AppData');
  });
});

describe('versionAtLeast', () => {
  it('按点分的各段数字比，缺的段按 0，后缀不看', () => {
    expect(versionAtLeast('1.14.0', '1.14.0')).toBe(true);
    expect(versionAtLeast('1.14.1', '1.14.0')).toBe(true);
    expect(versionAtLeast('1.15', '1.14.9')).toBe(true);
    expect(versionAtLeast('2.0.0-beta', '1.14.0')).toBe(true);
    expect(versionAtLeast('1.13.9', '1.14.0')).toBe(false);
    expect(versionAtLeast('1.9.0', '1.14.0')).toBe(false);
  });

  it('读不出版本号的当作不满足', () => {
    expect(versionAtLeast('', '1.14.0')).toBe(false);
    expect(versionAtLeast('dev', '1.14.0')).toBe(false);
  });

  it('要求的下限与 package.json 的 hostRequirements 是同一个数', () => {
    const manifest: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
    const requirements = isRecord(manifest) ? manifest['hostRequirements'] : undefined;
    const range = isRecord(requirements) ? requirements['foo_ui_webview2'] : undefined;
    expect(range).toBe(`>=${REQUIRED_HOST_VERSION}`);
  });
});
