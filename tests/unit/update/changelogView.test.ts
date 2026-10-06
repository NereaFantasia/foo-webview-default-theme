import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startChangelogView } from '../../../src/update/changelogView.ts';
import type { Changelog } from '../../../src/update/changelogFeed.ts';
import type { ChangelogCatalog } from '../../../src/update/changelog.ts';
import { confirmedStartupAtom } from '../../../src/update/loaderConfirmation.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';
import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';

const SEEN = 'defaultTheme.changelog.seen';
const STARTUP = {
  directory: 'E:\\theme',
  installId: '11111111-1111-4111-8111-111111111111',
  plugin: '2.0.0',
  session: {
    schema: 1,
    sessionId: '22222222-2222-4222-8222-222222222222',
    loader: 1,
    version: { v: '0.2.0', dir: '0.2.0' },
    skipped: [],
  },
} as const;
function entries(versions: string[]): Changelog {
  return {
    source: 'bundled',
    entries: versions.map((version) => ({
      version,
      date: null,
      notes: { en: { title: version, summary: 'Summary', items: [], fixes: [] } },
    })),
  };
}
function setup(seen?: string) {
  const host = installFakeHost();
  if (seen) host.config.set(SEEN, seen);
  const store = createStore();
  const updater = {
    changelog: atom<Changelog | null>(null),
    catalog: atom<ChangelogCatalog | null>(null),
    check: vi.fn(async () => {}),
  };
  const view = startChangelogView(store, updater, createMemoryConfigWriter(host.fb), host.fb);
  onTestFinished(view.dispose);
  store.set(confirmedStartupAtom, STARTUP);
  return { host, store, updater, view };
}

describe('更新日志的展示生命周期', () => {
  it('首次安装建立已读基线，不弹窗、不联网', async () => {
    const { host, store, view, updater } = setup();
    store.set(updater.changelog, entries(['0.2.0']));
    await vi.waitFor(() => expect(host.config.get(SEEN)).toBe('0.2.0'));
    expect(store.get(view.opened)).toBe(false);
    expect(updater.check).not.toHaveBeenCalled();
  });

  it('升级等本版日志读回后弹一次，关闭后刷新日志不重开', async () => {
    const { host, store, view, updater } = setup('0.1.0');
    await vi.waitFor(() => expect(host.callsTo('config.get').length).toBeGreaterThan(0));
    expect(store.get(view.opened)).toBe(false);
    expect(host.config.get(SEEN)).toBe('0.1.0');
    store.set(updater.changelog, entries(['0.3.0', '0.2.0', '0.1.0']));
    await vi.waitFor(() => expect(store.get(view.opened)).toBe(true));
    expect(store.get(view.selected)).toBe('0.2.0');
    await vi.waitFor(() => expect(host.config.get(SEEN)).toBe('0.2.0'));
    expect(updater.check).not.toHaveBeenCalled();
    view.close();
    store.set(updater.changelog, entries(['0.4.0', '0.2.0']));
    expect(store.get(view.opened)).toBe(false);
  });

  it.each(['0.2.0', '0.3.0'])('已读 %s 时当前版本不弹、不降低已读版本', async (seen) => {
    const { host, store, view, updater } = setup(seen);
    store.set(updater.changelog, entries(['0.2.0']));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.get(view.opened)).toBe(false);
    expect(host.config.get(SEEN)).toBe(seen);
    expect(host.callsTo('config.set')).toEqual([]);
  });

  it('手动打开只触发检查，默认选择可更新版；用户切换后新数据不抢选择', async () => {
    const { host, store, view, updater } = setup('0.2.0');
    await vi.waitFor(() => expect(host.callsTo('config.get').length).toBeGreaterThan(0));
    store.set(updater.changelog, entries(['0.3.0', '0.2.0', '0.1.0']));
    view.show();
    expect(updater.check).toHaveBeenCalledOnce();
    expect(store.get(view.selected)).toBe('0.2.0');
    store.set(updater.catalog, {
      context: { current: '0.2.0', plugin: '2.0.0', loader: 1, revoked: [], failed: [] },
      candidates: [],
      pending: null,
      target: '0.3.0',
    });
    expect(store.get(view.selected)).toBe('0.3.0');
    store.set(updater.catalog, null);
    expect(store.get(view.selected)).toBe('0.3.0');
    view.select('0.1.0');
    store.set(updater.changelog, entries(['0.4.0', '0.3.0', '0.2.0', '0.1.0']));
    expect(store.get(view.selected)).toBe('0.1.0');
    view.select('9.0.0');
    expect(store.get(view.selected)).toBe('0.1.0');
  });

  it('释放后晚到的日志不会弹窗或写入已读版本', async () => {
    const { host, store, view, updater } = setup('0.1.0');
    view.dispose();
    store.set(updater.changelog, entries(['0.2.0']));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.get(view.opened)).toBe(false);
    expect(host.config.get(SEEN)).toBe('0.1.0');
  });
});
