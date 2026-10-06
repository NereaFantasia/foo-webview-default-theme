import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { LICENSE_URL, THEME_VERSION, versionReport } from '../../../src/settings/about.ts';
import { isRecord } from '../../fixtures/hostAnswers.ts';

describe('about', () => {
  it('主题版本号与 package.json 的 version 是同一个数', () => {
    const manifest: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(isRecord(manifest) ? manifest['version'] : undefined).toBe(THEME_VERSION);
  });

  it('升级后的显示和复制信息使用新版本号', async () => {
    vi.resetModules();
    vi.doMock('../../../package.json', () => ({ default: { version: '0.1.1' } }));
    try {
      const next = await import('../../../src/settings/about.ts');
      expect(next.THEME_VERSION).toBe('0.1.1');
      expect(
        next.versionReport({
          foobar2000: 'foobar2000 v2.25',
          is64bit: false,
          isPortable: false,
          pluginName: 'foo_ui_webview2',
          pluginVersion: '2.1.0',
        }),
      ).toMatch(/^foo-webview-default-theme 0\.1\.1\n/);
    } finally {
      vi.doUnmock('../../../package.json');
      vi.resetModules();
    }
  });

  it('许可全文的网址是 https', () => {
    expect(new URL(LICENSE_URL).protocol).toBe('https:');
  });

  it('复制的文字：第一行是主题版本，后面是 foobar2000 与组件的诊断信息', () => {
    const report = versionReport({
      foobar2000: 'foobar2000 v2.25',
      is64bit: false,
      isPortable: false,
      pluginName: 'foo_ui_webview2',
      pluginVersion: '2.1.0',
    });
    expect(report.split('\n')).toEqual([
      `foo-webview-default-theme ${THEME_VERSION}`,
      'foobar2000 v2.25 (32-bit)',
      'foo_ui_webview2 2.1.0 (requires 2.0.0 or later)',
    ]);
  });
});
