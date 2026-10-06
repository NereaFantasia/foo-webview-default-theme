import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { TEMPLATE_DIRECTORY, installTemplateHost } from '../../fixtures/templateHost.ts';
import { startRunMarker } from '../../../src/update/runMarker.ts';
import { templateFiles } from '../../../src/update/templateFiles.ts';

const OWN = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

function setup(initial: Record<string, string> = {}) {
  const env = installTemplateHost(initial);
  const marker = startRunMarker(templateFiles(env.file, TEMPLATE_DIRECTORY), env.host.fb, OWN);
  onTestFinished(marker.dispose);
  return { env, marker };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('运行标记', () => {
  it('写下本次运行的标记；没有别的标记时不算共用', async () => {
    const { env, marker } = setup();
    env.tick(5_000);
    await marker.refresh();
    expect(env.files.has(`state/sessions/${OWN}.json`)).toBe(true);
    expect(marker.shared()).toBe(false);
  });

  it('别的标记在本标记第一次写入之后刷新过，才算另有 foobar2000 在用', async () => {
    const { env, marker } = setup();
    env.tick(5_000);
    await marker.refresh();
    env.tick(60_000);
    env.write(`state/sessions/${OTHER}.json`, '{}');
    expect(marker.shared()).toBe(false);
    await marker.refresh();
    expect(marker.shared()).toBe(true);
  });

  it('崩溃留下的旧标记不触发，交给清理删除', async () => {
    const { env, marker } = setup({ [`state/sessions/${OTHER}.json`]: '{}' });
    env.tick(5_000);
    await marker.refresh();
    expect(marker.shared()).toBe(false);
    expect(await marker.stale()).toEqual([`state/sessions/${OTHER}.json`]);
  });

  it('修改时间只到整秒，同一秒内的刷新要到下一轮才发现', async () => {
    const { env, marker } = setup();
    env.tick(5_000);
    await marker.refresh();
    env.tick(300);
    env.write(`state/sessions/${OTHER}.json`, '{}');
    await marker.refresh();
    expect(marker.shared()).toBe(false);
    env.tick(5_000);
    env.write(`state/sessions/${OTHER}.json`, '{}');
    await marker.refresh();
    expect(marker.shared()).toBe(true);
  });

  it('每 5 分钟刷新一次，退出前删掉自己的标记，释放后都停下', async () => {
    vi.useFakeTimers();
    const { env, marker } = setup();
    await marker.refresh();
    const writes = () => env.host.callsTo('file.write').length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(writes()).toBe(2);
    env.host.emit('app:beforeQuit', {});
    await vi.waitFor(() => expect(env.files.has(`state/sessions/${OWN}.json`)).toBe(false));
    marker.dispose();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(writes()).toBe(2);
  });

  it('写不进标记时按没发现处理', async () => {
    const { env, marker } = setup();
    env.failWrites.add(`state/sessions/${OWN}.json`);
    await marker.refresh();
    expect(marker.shared()).toBe(false);
    expect(await marker.stale()).toEqual([]);
  });
});
