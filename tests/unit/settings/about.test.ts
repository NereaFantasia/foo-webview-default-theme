import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { log, resetEventLog } from '../../../src/diagnostics/eventLog.ts';
import {
  LICENSE_URL,
  musicServiceReport,
  runtimeLogReport,
  THEME_VERSION,
  versionReport,
  windowStateText,
} from '../../../src/settings/about.ts';
import type { MusicStatus } from '../../../src/server/musicProtocol.ts';
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
          pluginVersion: '2.2.0',
        }),
      ).toMatch(/^foo-webview-default-theme 0\.1\.1\n/);
    } finally {
      vi.doUnmock('../../../package.json');
      vi.resetModules();
    }
  });

  it('运行日志报告：读到宿主版本时头是版本信息，没读到时是主题版本与浏览器标识', () => {
    resetEventLog();
    log.error('error', 'start', { name: 'TypeError' });
    const diagnostics = {
      foobar2000: 'foobar2000 v2.25',
      is64bit: true,
      isPortable: false,
      pluginName: 'foo_ui_webview2',
      pluginVersion: '2.2.0',
    };
    const full = runtimeLogReport(diagnostics);
    expect(full.startsWith(versionReport(diagnostics))).toBe(true);
    expect(full).toContain('error   start name=TypeError');
    const bare = runtimeLogReport(null);
    expect(bare).toMatch(new RegExp(`^foo-webview-default-theme ${THEME_VERSION}\nuser agent: `));
    expect(bare).toContain('error   start name=TypeError');
    resetEventLog();
  });

  it('窗口现状一行：视口、取整的像素比、深浅、语言与 Edge 内核主版本', () => {
    const snapshot = {
      width: 1280,
      height: 720,
      ratio: 1.2500000298,
      scheme: 'dark',
      locale: 'zh-CN',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.80',
    };
    expect(windowStateText(snapshot)).toBe(
      '[state] viewport=1280x720@1.25 scheme=dark locale=zh-CN runtime=Edge 130',
    );
    expect(windowStateText({ ...snapshot, ratio: 2, userAgent: 'Mozilla/5.0 Firefox/130.0' })).toBe(
      '[state] viewport=1280x720@2 scheme=dark locale=zh-CN',
    );
  });

  it('运行日志报告带现状行时，它紧跟在头的后面、日志的前面', () => {
    resetEventLog();
    const state = '[state] viewport=1x1@1 scheme=light locale=en';
    const text = runtimeLogReport(null, state);
    const lines = text.split('\n');
    expect(lines[0]).toBe(`foo-webview-default-theme ${THEME_VERSION}`);
    expect(lines[2]).toBe(state);
    expect(lines[3]).toBe('');
    expect(lines[4]).toMatch(/^\[log\] 0 entries/);
    resetEventLog();
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
      pluginVersion: '2.2.0',
    });
    expect(report.split('\n')).toEqual([
      `foo-webview-default-theme ${THEME_VERSION}`,
      'foobar2000 v2.25 (32-bit)',
      'foo_ui_webview2 2.2.0',
    ]);
  });

  it('在线音乐服务复制的文字：后端、网易云、配了才有的 lxserver 与最近一次失败，不含地址、昵称与令牌', () => {
    const music: MusicStatus = {
      platforms: ['wy', 'tx', 'kw'],
      ncm: 'loaded',
      lx: 'ready',
      lxServer: { url: 'http://192.168.1.2:9527', username: 'lxuser', hasToken: true },
      lxHosted: false,
      account: { nickname: '某人' },
      unblock: false,
    };
    const report = musicServiceReport({
      port: 52817,
      health: { version: '0.3.0', runtime: '24.21.0' },
      music,
      ncmVersion: '4.41.1',
      lastFailure: {
        seq: 1,
        ref: { platform: 'wy', id: '64317' },
        code: 'membership-required',
        at: Date.UTC(2026, 9, 18, 12),
      },
    });
    expect(report.split('\n')).toEqual([
      'backend: connected 127.0.0.1:52817, 0.3.0, Node 24.21.0',
      'netease: loaded 4.41.1, signed in, unblock off',
      'lxserver: ready, platforms tx kw',
      'last failure: wy:64317 membership-required 2026-10-18T12:00:00.000Z',
    ]);
    expect(report).not.toMatch(/192\.168|某人|lxuser/);
    expect(
      musicServiceReport({
        port: null,
        health: null,
        music: null,
        ncmVersion: null,
        lastFailure: null,
      }),
    ).toBe('backend: not connected');
    expect(
      musicServiceReport({
        port: 52817,
        health: null,
        music: { ...music, lx: 'unconfigured', lxServer: null, account: null, ncm: 'missing' },
        ncmVersion: null,
        lastFailure: null,
      }).split('\n'),
    ).toEqual(['backend: connected 127.0.0.1:52817', 'netease: missing, signed out, unblock off']);
  });
});
