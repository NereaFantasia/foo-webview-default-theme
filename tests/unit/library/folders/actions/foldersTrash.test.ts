import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  foldersTrashAtom,
  foldersTrashPaths,
  startFoldersTrash,
} from '../../../../../src/library/folders/actions/foldersTrash.ts';
import { UnitHost } from '../../../../fixtures/unitHost.ts';
import { FOLDER_TRACKS } from '../../../../fixtures/foldersLibrary.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';

function setup() {
  const host = new UnitHost();
  host.answer('file.getInfo', { success: true, exists: true, isFile: true, isDirectory: false });
  host.answer('file.delete', { success: true });
  const store = createStore();
  const service = startFoldersTrash(store, host.fb);
  onTestFinished(() => {
    service.dispose();
    host.dispose();
  });
  return { host, store, service, state: () => store.get(foldersTrashAtom) };
}
it('实际文件按大小写与分隔符去重，准备和取消确认不删除文件', async () => {
  const env = setup();
  const track = FOLDER_TRACKS[0]!;
  env.service.prepare([
    track,
    { ...track, subsong: 2, absolutePath: track.absolutePath.toLowerCase().replaceAll('\\', '/') },
  ]);
  expect(env.state().items).toHaveLength(1);
  expect(env.state().tracks).toBe(2);
  expect(env.host.callsTo('file.delete')).toEqual([]);
  env.service.dismiss();
  await env.service.confirm();
  expect(env.state().phase).toBe('closed');
  expect(env.host.callsTo('file.delete')).toEqual([]);
});
it('仅确认的本机普通文件移入回收站，失败与成功逐项保留', async () => {
  const env = setup();
  env.host.answer('file.delete', (params) => {
    expect(params.moveToTrash).toBe(true);
    expect(Object.keys(params).sort()).toEqual(['moveToTrash', 'path']);
    return params.path === FOLDER_TRACKS[0]!.absolutePath
      ? { success: true }
      : hostFailure('PERMISSION_DENIED');
  });
  env.service.prepare(FOLDER_TRACKS.slice(0, 2));
  await env.service.confirm();
  expect(env.state().phase).toBe('done');
  expect(env.state().items.map((item) => item.status)).toEqual(['ok', 'failed']);
});
it('遇到目录、无法解析的路径和环境变量不执行删除', async () => {
  const env = setup();
  const track = FOLDER_TRACKS[0]!;
  const invalid = [
    '',
    'https://example.test/a.flac',
    'E:\\%NAME%\\a.flac',
    '\\\\server\\share\\a.flac',
  ];
  expect(
    foldersTrashPaths(invalid.map((absolutePath) => ({ ...track, absolutePath }))).unsupported,
  ).toBe(4);
  env.service.prepare([track, { ...track, absolutePath: invalid[1]! }]);
  await env.service.confirm();
  expect(env.state().phase).toBe('confirm');
  env.host.answer('file.getInfo', {
    success: true,
    exists: true,
    isDirectory: true,
    isFile: false,
  });
  env.service.prepare([track]);
  await env.service.confirm();
  expect(env.state().items[0]?.status).toBe('failed');
  expect(env.host.callsTo('file.delete')).toEqual([]);
});
it('停止只取消后续文件，重复确认不会重发当前文件', async () => {
  const env = setup();
  const held = env.host.hold('file.delete');
  env.service.prepare(FOLDER_TRACKS.slice(0, 2));
  const work = env.service.confirm();
  await vi.waitFor(() => expect(held.pending.length).toBe(1));
  await env.service.confirm();
  env.service.cancel();
  held.release();
  await work;
  expect(env.state().items.map((item) => item.status)).toEqual(['ok', 'cancelled']);
  expect(env.host.callsTo('file.delete').map((item) => item.path)).toEqual([
    FOLDER_TRACKS[0]!.absolutePath,
  ]);
});
it('删除应答丢失后标为未知并停止，不自动重试', async () => {
  const env = setup();
  env.host.answer('file.delete', () => {
    throw new Error('通道中断');
  });
  env.service.prepare(FOLDER_TRACKS.slice(0, 2));
  await env.service.confirm();
  expect(env.state().items.map((item) => item.status)).toEqual(['unknown', 'cancelled']);
  await env.service.confirm();
  expect(env.host.callsTo('file.delete').map((item) => item.path)).toEqual([
    FOLDER_TRACKS[0]!.absolutePath,
  ]);
});
it('释放时尚在校验文件，迟到应答不能继续下发删除', async () => {
  const env = setup();
  const held = env.host.hold('file.getInfo');
  env.service.prepare(FOLDER_TRACKS.slice(0, 2));
  const work = env.service.confirm();
  await vi.waitFor(() => expect(held.pending.length).toBe(1));
  env.service.dispose();
  held.release();
  await work;
  expect(env.host.callsTo('file.delete')).toEqual([]);
});
