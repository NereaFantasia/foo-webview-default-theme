import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { AlbumKey } from '../../../src/host/libraryContract.ts';
import { historyAtom, startNavHistory } from '../../../src/nav/navHistory.ts';
import {
  OPEN_SPINNER_DELAY_MS,
  startObjectOpener,
  type Availability,
  type KindOpener,
  type Prepared,
} from '../../../src/nav/objectOpener.ts';
import type { ObjectRef } from '../../../src/nav/objectRef.ts';
import { READY_KINDS } from '../../fixtures/objectKinds.ts';

const ALBUM: ObjectRef = { kind: 'album', key: 'Blue\0Joni' as AlbumKey };
const ARTIST: ObjectRef = { kind: 'artist', name: 'Joni' };
const LIST: ObjectRef = {
  kind: 'onlineList',
  list: { kind: 'album', ref: { platform: 'wy', id: '1' }, title: 'T' },
};

/** 专辑一种要先取数据，取的结果由测试手动交回；其余两种直接进页 */
function setup() {
  vi.useFakeTimers();
  onTestFinished(() => void vi.useRealTimers());
  const store = createStore();
  const history = startNavHistory(store);
  const answers: ((prepared: Prepared) => void)[] = [];
  const entered: string[] = [];
  const catalog = atom<Availability>('ready');
  const objects = startObjectOpener(store, {
    history,
    kinds: {
      ...READY_KINDS,
      album: {
        revision: catalog,
        availability: () => store.get(catalog),
        prepare: () => new Promise<Prepared>((resolve) => answers.push(resolve)),
      },
      onlineList: { availability: () => 'missing' },
    },
  });
  onTestFinished(() => objects.dispose());
  const found = (name: string): Prepared => ({ ok: true, enter: () => entered.push(name) });
  return {
    store,
    history,
    objects,
    answers,
    entered,
    catalog,
    found,
    place: () => store.get(historyAtom).place,
    pending: () => store.get(objects.pending),
    notice: () => store.get(objects.notice),
  };
}

describe('对象打开服务', () => {
  it('不用取数据的种类直接进页，记成深入', async () => {
    const { objects, place, store } = setup();
    await expect(objects.open(ARTIST)).resolves.toBe('done');
    expect(place()).toEqual({ id: 'artists', subject: 'Joni' });
    expect(store.get(historyAtom).arrival?.kind).toBe('drill');
  });

  it('要取数据的取到了先做进页前的事再进，转圈等过延迟才出、到了就撤', async () => {
    const { objects, answers, entered, found, place, pending } = setup();
    const result = objects.open(ALBUM, { origin: 'cover' });
    await vi.advanceTimersByTimeAsync(OPEN_SPINNER_DELAY_MS - 10);
    expect(pending()).toBeNull();
    await vi.advanceTimersByTimeAsync(20);
    expect(pending()).toMatchObject({ ref: ALBUM, origin: 'cover' });
    answers[0]?.(found('blue'));
    await expect(result).resolves.toBe('done');
    expect(entered).toEqual(['blue']);
    expect(place()).toEqual({ id: 'album', subject: 'Blue\0Joni' });
    expect(pending()).toBeNull();
  });

  it('取不到：不进页，挂提示并交回原因；下一次打开成了提示清掉', async () => {
    const { objects, answers, place, notice } = setup();
    const result = objects.open(ALBUM);
    answers[0]?.({ ok: false, result: 'missing', notice: 'albumDetail.notFound' });
    await expect(result).resolves.toBe('missing');
    expect(place()).toEqual({ id: 'albums' });
    expect(notice()).toBe('albumDetail.notFound');
    await objects.open(ARTIST);
    expect(notice()).toBeNull();
  });

  it('等专辑时点了艺人：专辑作废，晚到了也不进，转圈撤掉', async () => {
    const { objects, answers, entered, found, place, pending } = setup();
    const album = objects.open(ALBUM);
    await vi.advanceTimersByTimeAsync(OPEN_SPINNER_DELAY_MS + 10);
    expect(pending()).not.toBeNull();
    await objects.open(ARTIST);
    expect(pending()).toBeNull();
    answers[0]?.(found('blue'));
    await expect(album).resolves.toBe('superseded');
    expect(entered).toEqual([]);
    expect(place()).toEqual({ id: 'artists', subject: 'Joni' });
  });

  it('等的途中历史变了（侧边栏、后退）：作废', async () => {
    const { objects, answers, found, history, place, pending } = setup();
    const album = objects.open(ALBUM);
    await vi.advanceTimersByTimeAsync(OPEN_SPINNER_DELAY_MS + 10);
    history.navigate({ id: 'songs' });
    expect(pending()).toBeNull();
    answers[0]?.(found('blue'));
    await expect(album).resolves.toBe('superseded');
    expect(place()).toEqual({ id: 'songs' });
  });

  it('释放后打开交回 disposed，途中释放的也是', async () => {
    const { objects, answers, found } = setup();
    const album = objects.open(ALBUM);
    objects.dispose();
    answers[0]?.(found('blue'));
    await expect(album).resolves.toBe('disposed');
    await expect(objects.open(ARTIST)).resolves.toBe('disposed');
  });

  it('已在目标页时 isHere 为真，再打开不多记历史', async () => {
    const { objects, store } = setup();
    expect(objects.isHere(ARTIST)).toBe(false);
    await objects.open(ARTIST);
    expect(objects.isHere(ARTIST)).toBe(true);
    const entry = store.get(historyAtom).entry;
    await objects.open(ARTIST);
    expect(store.get(historyAtom).entry).toBe(entry);
  });

  it('可用性按种类答，目录变了 revision 跟着变', () => {
    const { objects, store, catalog } = setup();
    expect(objects.availability(ARTIST)).toBe('ready');
    expect(objects.availability(LIST)).toBe('missing');
    const before = store.get(objects.revision);
    store.set(catalog, 'pending');
    expect(objects.availability(ALBUM)).toBe('pending');
    expect(store.get(objects.revision)).not.toBe(before);
  });
});

/** 艺人一种换成带钩子的打开器，其余不用取数据 */
function startWith(artist: KindOpener<Extract<ObjectRef, { kind: 'artist' }>>) {
  const store = createStore();
  const history = startNavHistory(store);
  const objects = startObjectOpener(store, {
    history,
    kinds: { ...READY_KINDS, artist },
  });
  onTestFinished(() => objects.dispose());
  return { store, objects, place: () => store.get(historyAtom).place };
}

describe('种类自己的钩子', () => {
  it('进页之后接着做：钩子被调时历史已经到了目标页', async () => {
    const seen: unknown[] = [];
    const { objects, place } = startWith({
      availability: () => 'ready',
      arrived: (ref) => seen.push([ref.name, place()]),
    });
    await expect(objects.open(ARTIST)).resolves.toBe('done');
    expect(seen).toEqual([['Joni', { id: 'artists', subject: 'Joni' }]]);
  });

  it('种类自己办完：服务不再导航，交回它说的结果，提示清掉', async () => {
    const settled: string[] = [];
    const { objects, place } = startWith({
      availability: () => 'ready',
      prepare: () =>
        Promise.resolve({
          ok: true,
          settle: () => {
            settled.push('explorer');
            return Promise.resolve('external');
          },
        }),
    });
    await expect(objects.open(ARTIST)).resolves.toBe('external');
    expect(settled).toEqual(['explorer']);
    expect(place()).toEqual({ id: 'albums' });
    expect(objects.isHere(ARTIST)).toBe(false);
  });

  it('等的途中被后来的打开作废：种类的 settle 不调', async () => {
    let release: (prepared: Prepared) => void = () => {};
    let called = false;
    const { objects, place } = startWith({
      availability: () => 'ready',
      prepare: () => new Promise<Prepared>((resolve) => (release = resolve)),
    });
    const first = objects.open(ARTIST);
    await objects.open(LIST);
    release({
      ok: true,
      settle: () => {
        called = true;
        return Promise.resolve('done');
      },
    });
    await expect(first).resolves.toBe('superseded');
    expect(called).toBe(false);
    expect(place().id).toBe('onlineList');
  });

  it('失败的 notice 为 null 时不挂提示，原因交回给调用方', async () => {
    const { objects, store } = startWith({
      availability: () => 'ready',
      prepare: () => Promise.resolve({ ok: false, result: 'failed', notice: null }),
    });
    await expect(objects.open(ARTIST)).resolves.toBe('failed');
    expect(store.get(objects.notice)).toBeNull();
  });
});
