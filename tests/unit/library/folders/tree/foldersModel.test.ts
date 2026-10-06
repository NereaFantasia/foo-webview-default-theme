import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  foldersAddress,
  foldersSubject,
  foldersHitAddress,
  foldersRoot,
} from '../../../../../src/library/folders/tree/foldersModel.ts';
import {
  startPlaybackSource,
  playbackSourceAtom,
  sourceHome,
} from '../../../../../src/playback/playbackSource.ts';
import { createMemoryConfigWriter } from '../../../../fixtures/dataWriter.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';
import { FOLDER_ROOT } from '../../../../fixtures/foldersLibrary.ts';

it('目录主体保持根及相对目录，不因引号、斜杠和中文丢失身份', () => {
  const address = { rootId: '\\\\server\\音樂', pathId: '专辑/一号' };
  expect(foldersAddress(foldersSubject(address))).toEqual(address);
  expect(foldersAddress('[1,"x"]')).toBeNull();
  expect(foldersAddress('bad')).toBeNull();
  const roots = [
    foldersRoot(FOLDER_ROOT),
    foldersRoot({ ...FOLDER_ROOT, id: 'nested', absolutePath: 'E:\\Music\\Alpha' }),
  ];
  expect(foldersHitAddress('E:/Music/Alpha/Disc/one.flac', roots)).toEqual({
    rootId: 'nested',
    pathId: 'disc',
  });
  expect(foldersHitAddress('E:/MusicOther/one.flac', roots)).toBeNull();
});
it('文件夹来源可以存取并原样回跳，特殊目录标识不做解码改写', async () => {
  const host = installFakeHost();
  const store = createStore();
  const service = startPlaybackSource(store, host.fb, createMemoryConfigWriter(host.fb));
  onTestFinished(() => service.dispose());
  await service.ready;
  const subject = foldersSubject({ rootId: FOLDER_ROOT.id, pathId: 'Alpha/Disc' });
  service.record({ kind: 'folder', subject, name: 'Disc' });
  expect(store.get(playbackSourceAtom)).toEqual({ kind: 'folder', subject, name: 'Disc' });
  expect(sourceHome({ kind: 'folder', subject, name: 'Disc' })).toEqual({ id: 'folders', subject });
  await vi.waitFor(() =>
    expect(host.config.get('defaultTheme.playback.source')).toMatchObject({
      kind: 'folder',
      subject,
    }),
  );
});
