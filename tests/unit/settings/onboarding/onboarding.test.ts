import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  ONBOARDING_KEY,
  startOnboarding,
  type OnboardingDeps,
} from '../../../../src/settings/onboarding/onboarding.ts';
import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import type { AnswerTable } from '../../../fixtures/fakeHost.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

interface SetupOptions {
  readonly record?: { readonly version: number; readonly outcome: string };
  readonly answers?: AnswerTable;
  readonly blocking?: boolean;
  readonly shown?: Promise<unknown>;
  readonly writer?: OnboardingDeps['writer'];
}

function setup(options: SetupOptions = {}) {
  const host = installFakeHost({ answers: options.answers });
  if (options.record) host.config.set(ONBOARDING_KEY, options.record);
  const store = createStore();
  const blocking = atom(options.blocking ?? false);
  const service = startOnboarding(
    store,
    {
      writer: options.writer ?? createMemoryConfigWriter(host.fb),
      checked: Promise.resolve(),
      blocking,
      shown: options.shown ?? Promise.resolve(),
    },
    host.fb,
  );
  onTestFinished(service.dispose);
  return { host, store, service, blocking };
}

/** 判断要等几次宿主往返；等到读过记录与窗口之后再多等一拍，确认没有打开。 */
async function settled(host: ReturnType<typeof installFakeHost>): Promise<void> {
  await vi.waitFor(() => expect(host.callsTo('window.getCurrentWindowId').length).toBe(1));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('新人引导：要不要打开', () => {
  it('没有记录、主窗口、没有阻断级消息时打开，停在第 1 步', async () => {
    const { store, service } = setup();
    await vi.waitFor(() => expect(store.get(service.state).open).toBe(true));
    expect(store.get(service.state)).toEqual({
      open: true,
      step: 'library',
      direction: 'forward',
    });
  });

  it('已有记录时不打开，跳过的也算', async () => {
    const { host, store, service } = setup({ record: { version: 1, outcome: 'skipped' } });
    await settled(host);
    expect(store.get(service.state).open).toBe(false);
  });

  it('记录读失败时不打开：分不清是没有还是读不到', async () => {
    const { host, store, service } = setup({
      answers: { config: { get: hostFailure('OPERATION_FAILED') } },
    });
    await settled(host);
    expect(store.get(service.state).open).toBe(false);
  });

  it('不是主窗口时不打开', async () => {
    const { host, store, service } = setup({
      answers: { window: { getCurrentWindowId: { success: true, windowId: 'popup-1' } } },
    });
    await settled(host);
    expect(store.get(service.state).open).toBe(false);
  });

  it('有阻断级消息时不打开', async () => {
    const { host, store, service } = setup({ blocking: true });
    await settled(host);
    expect(store.get(service.state).open).toBe(false);
  });

  it('等启动等待层收起之后才打开', async () => {
    let show = () => {};
    const shown = new Promise<void>((resolve) => {
      show = resolve;
    });
    const { host, store, service } = setup({ shown });
    await settled(host);
    expect(store.get(service.state).open).toBe(false);
    show();
    await vi.waitFor(() => expect(store.get(service.state).open).toBe(true));
  });

  it('释放之后晚到的判断不再打开', async () => {
    let show = () => {};
    const shown = new Promise<void>((resolve) => {
      show = resolve;
    });
    const { host, store, service } = setup({ shown });
    await settled(host);
    service.dispose();
    show();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.get(service.state).open).toBe(false);
  });
});

describe('新人引导：换步与收尾', () => {
  async function opened() {
    const env = setup();
    await vi.waitFor(() => expect(env.store.get(env.service.state).open).toBe(true));
    return env;
  }

  it('下一步、上一步按顺序走，并记下方向；两头不越界', async () => {
    const { store, service } = await opened();
    service.back();
    expect(store.get(service.state).step).toBe('library');
    service.next();
    service.next();
    service.next();
    expect(store.get(service.state)).toMatchObject({ step: 'update', direction: 'forward' });
    service.next();
    expect(store.get(service.state).step).toBe('update');
    service.back();
    expect(store.get(service.state)).toMatchObject({ step: 'tray', direction: 'back' });
  });

  it('完成时关掉并写下带版本的记录', async () => {
    const { host, store, service } = await opened();
    await expect(service.finish('completed')).resolves.toBe(true);
    expect(store.get(service.state).open).toBe(false);
    expect(host.config.get(ONBOARDING_KEY)).toEqual({ version: 1, outcome: 'completed' });
  });

  it('跳过也写记录；重复收尾只写一次', async () => {
    const { host, service } = await opened();
    const first = service.finish('skipped');
    const second = service.finish('completed');
    expect(second).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(host.config.get(ONBOARDING_KEY)).toEqual({ version: 1, outcome: 'skipped' });
    expect(host.callsTo('config.set')).toHaveLength(1);
  });

  it('记录没写成也照样关掉，答 false', async () => {
    const env = setup({
      writer: { set: () => Promise.resolve({ success: false, reason: 'write-failed' }) },
    });
    await vi.waitFor(() => expect(env.store.get(env.service.state).open).toBe(true));
    await expect(env.service.finish('completed')).resolves.toBe(false);
    expect(env.store.get(env.service.state).open).toBe(false);
  });

  it('关掉之后换步不再生效', async () => {
    const { store, service } = await opened();
    void service.finish('skipped');
    service.next();
    expect(store.get(service.state)).toMatchObject({ open: false, step: 'library' });
  });
});

describe('新人引导：重启前先写记录', () => {
  it('save 只写记录、引导还开着；之后完成只关掉，不再写', async () => {
    const env = setup();
    await vi.waitFor(() => expect(env.store.get(env.service.state).open).toBe(true));
    await expect(env.service.save('completed')).resolves.toBe(true);
    expect(env.store.get(env.service.state).open).toBe(true);
    expect(env.host.config.get(ONBOARDING_KEY)).toEqual({ version: 1, outcome: 'completed' });
    await expect(env.service.finish('skipped')).resolves.toBe(true);
    expect(env.store.get(env.service.state).open).toBe(false);
    expect(env.host.config.get(ONBOARDING_KEY)).toEqual({ version: 1, outcome: 'completed' });
    expect(env.host.callsTo('config.set')).toHaveLength(1);
  });
});
