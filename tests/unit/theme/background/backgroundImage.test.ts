import { createStore } from 'jotai/vanilla';
import { expect, onTestFinished, test, vi } from 'vitest';
import {
  backgroundImageAtom,
  MAX_BACKGROUND_BYTES,
  requestBackgroundImage,
  startBackgroundImage,
} from '../../../../src/theme/background/backgroundImage.ts';
import {
  backgroundPreferencesAtom,
  backgroundSourceAtom,
  chooseBackgroundSource,
} from '../../../../src/theme/background/windowBackground.ts';
import { defer } from '../../../fixtures/coverArt.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(nativeDecode = false) {
  const host = installFakeHost();
  host.answer('misc.getProfilePath', {
    success: true,
    path: 'E:\\Profile\\',
    value: 'E:\\Profile\\',
  });
  host.answer('dialog.openFile', {
    success: true,
    filePaths: ['D:\\Pictures\\cover.png'],
    canceled: false,
  });
  host.answer('file.read', { success: true, content: 'AQID', size: 3, encoding: 'base64' });
  host.answer('file.write', { success: true, bytesWritten: 3 });
  const store = createStore();
  const decode = vi.fn(async () => 'data:image/png;base64,AQID');
  const service = startBackgroundImage(store, {
    host: host.fb,
    storage: null,
    ...(nativeDecode ? {} : { decode }),
  });
  onTestFinished(() => service.dispose());
  return { host, store, decode, service };
}

test('先验证图片再原子写入 profile 私有副本，只保存文件显示名', async () => {
  const { host, store, decode } = setup();
  requestBackgroundImage(store, true);
  await flush();
  expect(decode).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  expect(host.callsTo('dialog.openFile')[0]).toEqual({
    multiple: false,
    filters: [{ extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif'] }],
  });
  expect(host.callsTo('file.read')[0]).toEqual({
    path: 'D:\\Pictures\\cover.png',
    encoding: 'binary',
  });
  expect(host.callsTo('file.write')[0]).toEqual({
    path: 'E:\\Profile\\default-theme\\background.image',
    content: 'base64:AQID',
    encoding: 'binary',
    atomic: true,
  });
  expect(store.get(backgroundImageAtom).status).toBe('ready');
  expect(store.get(backgroundPreferencesAtom).imageName).toBe('cover.png');
});

test('取消不读写文件、不改变当前图片', async () => {
  const { host, store } = setup();
  host.answer('dialog.openFile', { success: true, filePaths: [], canceled: true });
  const before = store.get(backgroundImageAtom);
  requestBackgroundImage(store, true);
  await flush();
  expect(store.get(backgroundImageAtom)).toBe(before);
  expect(host.callsTo('file.read')).toHaveLength(0);
  expect(host.callsTo('file.write')).toHaveLength(0);
});

test('解码失败不覆盖副本；写入失败不发布新图', async () => {
  const { host, store, decode } = setup();
  decode.mockRejectedValueOnce(new Error('不是图片'));
  requestBackgroundImage(store, true);
  await flush();
  expect(host.callsTo('file.write')).toHaveLength(0);
  expect(store.get(backgroundImageAtom)).toEqual({ status: 'failed', url: '', failure: 'decode' });
  host.answer('file.write', hostFailure('OPERATION_FAILED'));
  requestBackgroundImage(store, true);
  await flush();
  expect(store.get(backgroundImageAtom)).toEqual({ status: 'failed', url: '', failure: 'save' });
  expect(store.get(backgroundPreferencesAtom).imageName).toBe('');
});

test('副本读取失败保持图片来源，重试可恢复', async () => {
  const { host, store } = setup();
  host.answer('file.read', hostFailure('NOT_FOUND'));
  chooseBackgroundSource(store, 'image', null);
  await flush();
  expect(store.get(backgroundSourceAtom)).toBe('image');
  expect(store.get(backgroundImageAtom)).toEqual({ status: 'failed', url: '', failure: 'read' });
  host.answer('file.read', { success: true, content: 'AQID', size: 3, encoding: 'base64' });
  requestBackgroundImage(store, false);
  await flush();
  expect(store.get(backgroundImageAtom).status).toBe('ready');
  expect(store.get(backgroundImageAtom).failure).toBeUndefined();
});

test('文件选择失败保留当前图片，区别于读取失败', async () => {
  const { host, store } = setup();
  requestBackgroundImage(store, true);
  await flush();
  const previous = store.get(backgroundImageAtom).url;
  host.answer('dialog.openFile', hostFailure('OPERATION_FAILED'));
  requestBackgroundImage(store, true);
  await flush();
  expect(store.get(backgroundImageAtom)).toEqual({
    status: 'failed',
    failure: 'choose',
    url: previous,
  });
});

test('超过字节限制时不解码，明确返回文件大小错误', async () => {
  const { host, store, decode } = setup();
  const read = vi
    .spyOn(host.fb.file, 'readBinary')
    .mockResolvedValue(new Uint8Array(MAX_BACKGROUND_BYTES + 1));
  onTestFinished(() => read.mockRestore());
  requestBackgroundImage(store, true);
  await flush();
  expect(store.get(backgroundImageAtom).failure).toBe('bytes');
  expect(decode).not.toHaveBeenCalled();
  expect(host.callsTo('file.write')).toHaveLength(0);
});

test('超过像素限制时关闭位图，不保存新图', async () => {
  const { host, store } = setup(true);
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 8001, height: 8000, close }),
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  requestBackgroundImage(store, true);
  await flush();
  expect(store.get(backgroundImageAtom).failure).toBe('pixels');
  expect(close).toHaveBeenCalledOnce();
  expect(host.callsTo('file.write')).toHaveLength(0);
});

test('释放后到达的解码结果不能保存或发布', async () => {
  const { host, store, decode, service } = setup();
  const pending = defer<string>();
  decode.mockReturnValueOnce(pending.promise);
  requestBackgroundImage(store, true);
  await flush();
  service.dispose();
  pending.resolve('data:image/png;base64,AQID');
  await flush();
  expect(host.callsTo('file.write')).toHaveLength(0);
  expect(store.get(backgroundImageAtom).status).not.toBe('ready');
});
