import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { startNcmSetup } from '../../../../../src/library/search/online/ncmSetup.ts';
import { MusicClientError } from '../../../../../src/playback/musicClient.ts';
import type { NcmComponentState } from '../../../../../src/server/ncmComponent.ts';

const PACKAGE = { version: '4.41.1', size: 1000, unpackedSize: 3000, licenses: ['MIT'] };
const state = (patch: Partial<NcmComponentState>): NcmComponentState => ({
  package: PACKAGE,
  phase: 'missing',
  received: 0,
  failure: null,
  ...patch,
});

afterEach(() => {
  vi.useRealTimers();
});

function prepare() {
  const answers: ((value: NcmComponentState | Error) => void)[] = [];
  const next = () =>
    new Promise<NcmComponentState>((resolve, reject) =>
      answers.push((value) => (value instanceof Error ? reject(value) : resolve(value))),
    );
  const client = { ncm: vi.fn(next), installNcm: vi.fn(next) };
  const store = createStore();
  const service = startNcmSetup(store, client);
  onTestFinished(() => service.dispose());
  return { answers, client, store, setup: service, current: () => store.get(service.state) };
}

describe('网易云组件的安装状态', () => {
  it('读到状态；读不到时记下原因', async () => {
    const { answers, current, setup } = prepare();
    expect(current()).toEqual({ status: 'unknown' });
    setup.refresh();
    answers[0]?.(state({ phase: 'installed' }));
    await vi.waitFor(() => expect(current()).toMatchObject({ status: 'ready' }));
    setup.refresh();
    answers[1]?.(new MusicClientError('backend-unavailable'));
    await vi.waitFor(() =>
      expect(current()).toEqual({ status: 'failed', failure: 'backend-unavailable' }),
    );
  });

  it('下载途中隔一会儿再问，装好后停下', async () => {
    vi.useFakeTimers();
    const { answers, client, current, setup } = prepare();
    const started = setup.install();
    answers[0]?.(state({ phase: 'downloading', received: 10 }));
    await started;
    expect(client.ncm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(client.ncm).toHaveBeenCalledTimes(1);
    answers[1]?.(state({ phase: 'installed', received: 1000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(current()).toMatchObject({ component: { phase: 'installed' } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.ncm).toHaveBeenCalledTimes(1);
  });

  it('晚到的旧读不盖掉开始安装后的进度', async () => {
    const { answers, current, setup } = prepare();
    setup.refresh();
    const started = setup.install();
    answers[1]?.(state({ phase: 'downloading', received: 10 }));
    await started;
    answers[0]?.(state({ phase: 'missing' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(current()).toMatchObject({ component: { phase: 'downloading' } });
    setup.dispose();
  });
});
