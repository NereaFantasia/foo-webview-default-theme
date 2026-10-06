import { describe, expect, it } from 'vitest';
import { startVideoFullscreen } from '../../../src/video/videoFullscreen.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';

function setup(initial = false) {
  const host = installFakeHost();
  let active = initial;
  host.answer('window.isFullscreen', () => ({
    success: true,
    isFullscreen: active,
    fullscreen: active,
    windowId: 'main',
  }));
  host.answer('window.enterFullscreen', () => {
    active = true;
    return { success: true, isFullscreen: true };
  });
  host.answer('window.exitFullscreen', () => {
    active = false;
    return { success: true, isFullscreen: false };
  });
  const service = startVideoFullscreen();
  return { host, service, active: () => active };
}

describe('视频全屏所有权', () => {
  it('进入之前已全屏时，离页不退出宿主全屏', async () => {
    const { service, active } = setup(true);
    expect(await service.toggle()).toBe(true);
    expect(await service.leave()).toBe(true);
    service.dispose();
    expect(active()).toBe(true);
  });

  it('自己进入的全屏随离页退出', async () => {
    const { service, active } = setup();
    expect(await service.toggle()).toBe(true);
    expect(active()).toBe(true);
    expect(await service.leave()).toBe(true);
    expect(active()).toBe(false);
    service.dispose();
  });

  it('退出失败保留所有权，允许再次退出', async () => {
    const { host, service, active } = setup();
    await service.toggle();
    host.answer('window.exitFullscreen', hostFailure('OPERATION_FAILED'));
    expect(await service.leave()).toBe(false);
    expect(active()).toBe(true);
    host.answer('window.exitFullscreen', { success: true, isFullscreen: false });
    expect(await service.leave()).toBe(true);
    service.dispose();
  });

  it('进入请求在释放后成功时补发退出', async () => {
    const { host, service, active } = setup();
    const held = host.hold('window.enterFullscreen');
    const entering = service.toggle();
    await expect.poll(() => held.pending.length).toBe(1);
    service.dispose();
    held.release();
    expect(await entering).toBe(false);
    await expect.poll(active).toBe(false);
  });
});
