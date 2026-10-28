import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import { folderKind } from '../../../../src/library/folders/folderKind.ts';
import type { FoldersServices } from '../../../../src/library/folders/foldersServices.ts';
import { historyAtom, startNavHistory } from '../../../../src/nav/navHistory.ts';
import { startObjectOpener } from '../../../../src/nav/objectOpener.ts';
import type { ObjectRef } from '../../../../src/nav/objectRef.ts';
import { READY_KINDS } from '../../../fixtures/objectKinds.ts';

const LOCAL: ObjectRef = { kind: 'folder', path: 'E:\\Music\\Alpha\\a.flac' };
const ARTIST: ObjectRef = { kind: 'artist', name: 'Joni' };

type Folders = Pick<FoldersServices, 'locateFile' | 'enter' | 'showInExplorer'>;

/** 文件夹服务换成替身：目录怎么解析、资源管理器收不收由各用例给，进页记在历史里 */
function setup(overrides: Partial<Folders> = {}) {
  const store = createStore();
  const history = startNavHistory(store);
  const entered: string[] = [];
  const explored: string[] = [];
  const folders: Folders = {
    locateFile: () => Promise.resolve('dir'),
    enter(subject) {
      entered.push(subject);
      history.navigate({ id: 'folders', subject });
    },
    showInExplorer(path) {
      explored.push(path);
      return Promise.resolve(true);
    },
    ...overrides,
  };
  const objects = startObjectOpener(store, {
    history,
    // 替身只用到这三个方法，整份服务在这里不会被碰
    kinds: { ...READY_KINDS, folder: folderKind(() => folders as FoldersServices) },
  });
  onTestFinished(() => objects.dispose());
  return { store, objects, entered, explored, place: () => store.get(historyAtom).place };
}

describe('文件夹种类', () => {
  it('库根之下：进文件夹页的那个目录', async () => {
    const { objects, entered, explored, place, store } = setup();
    await expect(objects.open(LOCAL)).resolves.toBe('done');
    expect(entered).toEqual(['dir']);
    expect(explored).toEqual([]);
    expect(place()).toEqual({ id: 'folders', subject: 'dir' });
    expect(store.get(objects.notice)).toBeNull();
  });

  it('库外的文件：交给资源管理器，不进任何页面', async () => {
    const { objects, entered, explored, place } = setup({
      locateFile: () => Promise.resolve(null),
    });
    await expect(objects.open(LOCAL)).resolves.toBe('external');
    expect(explored).toEqual(['E:\\Music\\Alpha\\a.flac']);
    expect(entered).toEqual([]);
    expect(place()).toEqual({ id: 'albums' });
  });

  it('资源管理器没收：失败，不挂页面上的提示，原因交回调用方', async () => {
    const { objects, store } = setup({
      locateFile: () => Promise.resolve(null),
      showInExplorer: () => Promise.resolve(false),
    });
    await expect(objects.open(LOCAL)).resolves.toBe('failed');
    expect(store.get(objects.notice)).toBeNull();
  });

  it('读不到库根：失败，既不进页也不碰资源管理器', async () => {
    const { objects, entered, explored } = setup({ locateFile: () => Promise.resolve(undefined) });
    await expect(objects.open(LOCAL)).resolves.toBe('failed');
    expect(entered).toEqual([]);
    expect(explored).toEqual([]);
  });

  it('解析目录期间点了别的：这次作废，进页与资源管理器都不做', async () => {
    let answer: (subject: string | null) => void = () => {};
    const { objects, entered, explored, place } = setup({
      locateFile: () => new Promise((resolve) => (answer = resolve)),
    });
    const first = objects.open(LOCAL);
    await objects.open(ARTIST);
    answer(null);
    await expect(first).resolves.toBe('superseded');
    expect(entered).toEqual([]);
    expect(explored).toEqual([]);
    expect(place()).toEqual({ id: 'artists', subject: 'Joni' });
  });

  it('文件夹引用没有固定的页面：不算「已在这里」', async () => {
    const { objects } = setup();
    await objects.open(LOCAL);
    expect(objects.isHere(LOCAL)).toBe(false);
  });

  it('只有本地文件能开：压缩包里的、网络流与在线曲目没有所在目录', () => {
    const { objects } = setup();
    expect(objects.availability(LOCAL)).toBe('ready');
    expect(objects.availability({ kind: 'folder', path: 'unpack://x.zip|0|a.flac' })).toBe(
      'missing',
    );
    expect(objects.availability({ kind: 'folder', path: 'http://radio.example/stream' })).toBe(
      'missing',
    );
  });
});
