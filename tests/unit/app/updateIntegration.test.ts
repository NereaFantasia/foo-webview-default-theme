import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  requiredVersion,
  statusLine,
  updateLink,
  updateNotice,
} from '../../../src/app/updateIntegration.ts';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import type { StartupBlock } from '../../../src/update/loaderConfirmation.ts';
import type { UpdateStatus, UpdateMode } from '../../../src/update/updater.ts';
import type { Changelog } from '../../../src/update/changelogFeed.ts';

function noticeOf(
  status: UpdateStatus,
  mode: UpdateMode = 'notify',
  changelog: Changelog | null = null,
) {
  return createStore().get(
    updateNotice({ status: atom(status), mode: atom(mode), changelog: atom(changelog) }),
  );
}

describe('更新提示的映射', () => {
  it('只把要用户处理的状态交给信息中心', () => {
    expect(
      noticeOf({
        phase: 'ready',
        version: '0.2.0',
        notes: {},
        latest: '0.3.0',
        limit: 'plugin',
        pluginRange: '>=2.4.0',
      }),
    ).toEqual({ kind: 'updateReady', version: '0.2.0' });
    expect(
      noticeOf({
        phase: 'available',
        version: '0.2.0',
        latest: '0.2.0',
        limit: null,
        pluginRange: null,
      }),
    ).toEqual({ kind: 'updateAvailable', version: '0.2.0', title: '' });
    expect(
      noticeOf({ phase: 'blocked', latest: '0.3.0', limit: 'plugin', pluginRange: '>=2.4.0' }),
    ).toEqual({ kind: 'updatePlugin', latest: '0.3.0', required: '2.4.0' });
    expect(
      noticeOf({ phase: 'blocked', latest: '0.3.0', limit: 'stone', pluginRange: null }),
    ).toEqual({ kind: 'updateManual' });
    expect(noticeOf({ phase: 'manual', reason: 'trust' })).toEqual({ kind: 'updateManual' });
    expect(noticeOf({ phase: 'shared' })).toEqual({ kind: 'updateShared' });
    expect(noticeOf({ phase: 'idle', checkedAt: 1, failure: 'hash', gaveUp: true })).toEqual({
      kind: 'updateFailed',
    });
  });

  it('可用更新只在提醒档进入信息中心，并采用日志的语言回退标题', () => {
    const status = {
      phase: 'available',
      version: '0.2.0',
      latest: '0.2.0',
      limit: null,
      pluginRange: null,
    } as const;
    expect(noticeOf(status, 'off')).toBeNull();
    expect(noticeOf(status, 'auto')).toBeNull();
    expect(
      noticeOf(status, 'notify', {
        source: 'remote',
        entries: [
          {
            version: '0.2.0',
            date: null,
            notes: {
              'zh-CN': { title: '新的更新方式', summary: '摘要', items: [], fixes: [] },
            },
          },
        ],
      }),
    ).toEqual({ kind: 'updateAvailable', version: '0.2.0', title: '新的更新方式' });
  });

  it('暂时性失败、检查中与已是最新都不进信息中心', () => {
    for (const status of [
      { phase: 'off' },
      { phase: 'checking' },
      { phase: 'downloading', version: '0.2.0' },
      { phase: 'idle', checkedAt: null, failure: null, gaveUp: false },
      { phase: 'idle', checkedAt: 1, failure: 'offline', gaveUp: false },
    ] satisfies UpdateStatus[])
      expect(noticeOf(status)).toBeNull();
  });

  it('插件版本范围只留版本号', () => {
    expect(requiredVersion('>=2.4.0')).toBe('2.4.0');
    expect(requiredVersion(null)).toBe('');
  });

  it('设置卡的说明行：只写状态与出错原因，失败标成错误', () => {
    const t = createTranslate(zhCN, {});
    const line = (status: UpdateStatus, block: StartupBlock | null = null) =>
      statusLine(status, t, block);
    // 启动确认还没结束时没有原因可说
    expect(line({ phase: 'off' })).toEqual({ text: undefined, error: false });
    expect(line({ phase: 'off' }, { reason: 'layout' })).toEqual({
      text: '主题不是用完整主题包安装的，无法更新。请将完整主题包覆盖解压到模板目录',
      error: true,
    });
    expect(line({ phase: 'off' }, { reason: 'host', version: '2.0.1', required: '2.1.0' })).toEqual(
      {
        text: '需要 foo_ui_webview2 2.1.0 或更高（当前 2.0.1）。请先更新组件',
        error: true,
      },
    );
    expect(line({ phase: 'off' }, { reason: 'failed' })).toEqual({
      text: '启动确认失败，暂时无法更新',
      error: true,
    });
    // 运行方式本身不支持的只陈述，不标成错误
    expect(line({ phase: 'off' }, { reason: 'source' })).toEqual({
      text: '主题不是从模板目录加载的，不支持更新',
      error: false,
    });
    // 启动确认通过后更新器在运行，旧的原因不再显示
    expect(line({ phase: 'checking' }, { reason: 'layout' }).text).toBe('正在检查更新…');
    expect(line({ phase: 'off', reason: 'storage' })).toEqual({
      text: '浏览器存储不可用，更新已停用。请检查存储权限后重新打开主题',
      error: true,
    });
    expect(line({ phase: 'idle', checkedAt: null, failure: null, gaveUp: false })).toEqual({
      text: undefined,
      error: false,
    });
    expect(line({ phase: 'idle', checkedAt: 0, failure: null, gaveUp: false }).text).toMatch(
      /^已是最新版本 · .+ 检查$/,
    );
    expect(line({ phase: 'idle', checkedAt: 0, failure: 'clock', gaveUp: false })).toEqual({
      text: '证书校验失败，系统时间可能不准确',
      error: true,
    });
    expect(line({ phase: 'idle', checkedAt: 0, failure: 'hash', gaveUp: true }).text).toBe(
      '下载的更新文件不完整。已停止对此版本的自动重试。',
    );
    expect(line({ phase: 'downloading', version: '0.2.0' }).text).toBe('正在下载 0.2.0…');
    expect(
      line({
        phase: 'available',
        version: '0.2.0',
        latest: '0.2.0',
        limit: null,
        pluginRange: null,
      }),
    ).toEqual({ text: '可更新至 0.2.0', error: false });
    const ready = { phase: 'ready', version: '0.2.0', notes: {}, latest: '0.3.0' } as const;
    expect(line({ ...ready, limit: null, pluginRange: null }).text).toBe(
      '0.2.0 已下载，重启 foobar2000 后生效',
    );
    expect(line({ ...ready, limit: 'plugin', pluginRange: '>=2.4.0' }).text).toBe(
      '0.2.0 已下载。升级至 0.3.0 需要 foo_ui_webview2 2.4.0 或更高版本。',
    );
    expect(line({ ...ready, limit: 'stone', pluginRange: null }).text).toBe(
      '0.2.0 已下载，重启后将继续更新至 0.3.0',
    );
    expect(line({ phase: 'blocked', latest: '0.3.0', limit: 'manual', pluginRange: null })).toEqual(
      { text: '当前版本无法自动更新，请手动安装最新的主题包', error: true },
    );
    expect(line({ phase: 'manual', reason: 'state' })).toEqual({
      text: '保存的更新状态已损坏，重置后可以重新检查',
      error: true,
    });
    for (const reason of ['failed-releases', 'pointer'] as const)
      expect(line({ phase: 'manual', reason })).toEqual({
        text: '主题安装信息已损坏。请将完整主题包安装到新目录后使用。',
        error: true,
      });
  });

  it('设置卡按钮：该去下载页的状态答主题页或插件页，其余不跳转', () => {
    // 平铺要换完整主题包，插件太旧要换插件
    expect(updateLink({ phase: 'off' }, { reason: 'layout' })).toBe('theme');
    expect(
      updateLink({ phase: 'off' }, { reason: 'host', version: '2.0.1', required: '2.1.0' }),
    ).toBe('plugin');
    const blocked = { phase: 'blocked', latest: '0.3.0', pluginRange: null } as const;
    expect(updateLink({ ...blocked, limit: 'manual' })).toBe('theme');
    expect(updateLink({ phase: 'manual', reason: 'trust' })).toBe('theme');
    // 更新状态损坏走「重置」，插件版本不够时设置里有插件更新行
    expect(updateLink({ phase: 'manual', reason: 'state' })).toBeNull();
    expect(updateLink({ ...blocked, limit: 'plugin', pluginRange: '>=2.1.0' })).toBeNull();
    // 来源不支持、确认失败、确认进行中，都没有可跳转的页面
    for (const block of [{ reason: 'source' }, { reason: 'failed' }] as const)
      expect(updateLink({ phase: 'off' }, block)).toBeNull();
    expect(updateLink({ phase: 'off' })).toBeNull();
    expect(updateLink({ phase: 'checking' })).toBeNull();
  });
});
