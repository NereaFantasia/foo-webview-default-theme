import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import { startFoldersCovers } from '../../../../../src/library/folders/detail/foldersCovers.ts';
import { UnitHost } from '../../../../fixtures/unitHost.ts';

function setup() {
  const host = new UnitHost();
  const covers = startFoldersCovers(createStore(), host.fb);
  onTestFinished(() => {
    covers.dispose();
    host.dispose();
  });
  return { host, covers };
}
it('直接读取首曲路径，缺少专辑元数据也能得到封面', async () => {
  const { host, covers } = setup();
  host.answer('artwork.getFb2kUrlByPath', {
    success: true,
    available: true,
    type: 'front',
    path: 'file://E:\\Music\\first.flac',
    dataUrl: 'fb2k://art/first',
  });
  const path = 'file://E:\\Music\\untagged.flac';
  expect(covers.coverOf(path, 64)).toBeUndefined();
  await vi.waitFor(() => expect(covers.coverOf(path, 64)?.url).toBe('fb2k://art/first'));
  expect(host.callsTo('artwork.getFb2kUrlByPath')[0]).toMatchObject({ path });
  expect(covers.acquire(path)).toBe(true);
  covers.settle(path, 'load');
  expect(covers.coverOf(path, 64)?.url).toBe('fb2k://art/first');
});
it('升档图片失败时保留已经显示的封面，不反复请求失败档位', async () => {
  const { host, covers } = setup();
  const path = 'file://E:\\Music\\first.flac';
  host.answer('artwork.getFb2kUrlByPath', {
    success: true,
    available: true,
    type: 'front',
    path: 'file://E:\\Music\\first.flac',
    dataUrl: 'fb2k://art/small',
  });
  covers.coverOf(path, 64);
  await vi.waitFor(() => expect(covers.coverOf(path, 64)?.url).toBe('fb2k://art/small'));
  covers.acquire(path);
  covers.settle(path, 'load');
  host.answer('artwork.getFb2kUrlByPath', {
    success: true,
    available: true,
    type: 'front',
    path: 'file://E:\\Music\\first.flac',
    dataUrl: 'fb2k://art/large',
  });
  covers.coverOf(path, 512);
  await vi.waitFor(() => expect(covers.coverOf(path, 512)?.url).toBe('fb2k://art/large'));
  covers.acquire(path);
  covers.settle(path, 'error');
  expect(covers.coverOf(path, 512)?.url).toBe('fb2k://art/small');
  expect(covers.acquire(path)).toBe(true);
  covers.settle(path, 'load');
  expect(covers.coverOf(path, 512)?.url).toBe('fb2k://art/small');
});
it('释放后晚到的封面地址不写回', async () => {
  const { host, covers } = setup();
  const held = host.hold('artwork.getFb2kUrlByPath');
  const path = 'file://E:\\Music\\late.flac';
  covers.coverOf(path, 64);
  await vi.waitFor(() => expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(1));
  covers.dispose();
  held.respond(0, {
    success: true,
    available: true,
    type: 'front',
    path: 'file://E:\\Music\\first.flac',
    dataUrl: 'fb2k://art/late',
  });
  await Promise.resolve();
  expect(covers.coverOf(path, 64)).toBeUndefined();
});
