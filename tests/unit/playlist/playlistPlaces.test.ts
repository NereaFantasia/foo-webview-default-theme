import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { historyAtom, startNavHistory } from '../../../src/nav/navHistory.ts';
import { placeName } from '../../../src/nav/places.ts';
import { startPlaylistPlaces } from '../../../src/playlist/playlistPlaces.ts';
import { startPlaylists } from '../../../src/playback/playlists.ts';
import { FakePlaylists, guidOf, makePlaylist } from '../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function start(names: readonly string[]) {
  const host = installFakeHost();
  const fake = new FakePlaylists(
    host,
    names.map((name, index) => makePlaylist(index, name, { isActive: index === 0 })),
    (event, payload) => host.emit(event, payload),
  );
  const store = createStore();
  const history = startNavHistory(store);
  const playlists = startPlaylists(store, host.fb);
  await playlists.ready;
  const places = startPlaylistPlaces(store, history, playlists);
  const current = () => store.get(historyAtom);
  return { host, fake, history, places, current };
}

describe('startPlaylistPlaces', () => {
  it('去一张列表：进历史、主体是它的 GUID，并在宿主里激活它', async () => {
    const { fake, places, current } = await start(['Default', 'Chill']);
    places.open(guidOf(1));
    expect(current().place).toEqual({ id: 'playlist', subject: guidOf(1) });
    await settle();
    expect(fake.activeGuid()).toBe(guidOf(1));
  });

  it('后退回到列表的记录时重新激活那张；改了名、挪了位置都认得', async () => {
    const { host, fake, places, history, current } = await start(['Default', 'Chill', 'Road']);
    places.open(guidOf(2));
    await settle();
    history.navigate({ id: 'albums' });
    await host.fb.playlist.setActive(guidOf(0));
    await host.fb.playlist.rename(guidOf(2), 'Weekend');
    await host.fb.playlist.reorderPlaylists([2, 0, 1]);
    await settle();
    expect(fake.names()).toEqual(['Weekend', 'Default', 'Chill']);

    expect(history.back()).toBe(true);
    await settle();
    expect(current().place).toEqual({ id: 'playlist', subject: guidOf(2) });
    expect(fake.activeGuid()).toBe(guidOf(2));
  });

  it('列表删了：后退越过那一条，去向在删的那一刻就重算', async () => {
    const { host, places, history, current } = await start(['Default', 'Chill', 'Road']);
    places.open(guidOf(1));
    await settle();
    places.open(guidOf(2));
    await settle();
    expect(current().previous).toEqual({ id: 'playlist', subject: guidOf(1) });
    await host.fb.playlist.remove(guidOf(1));
    await settle();
    expect(current().previous).toEqual({ id: 'albums' });
    expect(history.back()).toBe(true);
    expect(current().place).toEqual({ id: 'albums' });
  });

  it('正在看的列表在宿主里被切走：当前这条跟着改成宿主激活的那张', async () => {
    const { host, places, current } = await start(['Default', 'Chill', 'Road']);
    places.open(guidOf(1));
    await settle();
    await host.fb.playlist.setActive(guidOf(2));
    await settle();
    expect(current().place).toEqual({ id: 'playlist', subject: guidOf(2) });
  });

  it('正在看的列表被删了：之后激活的是别的列表，这一条也不改写过去，后退时越过它', async () => {
    const { host, places, history, current } = await start(['Default', 'Chill', 'Road']);
    places.open(guidOf(1));
    await settle();
    await host.fb.playlist.remove(guidOf(1));
    await host.fb.playlist.setActive(guidOf(2));
    await settle();
    expect(current().place).toEqual({ id: 'playlist', subject: guidOf(1) });
    history.navigate({ id: 'settings' });
    expect(current().previous).toEqual({ id: 'albums' });
  });

  it('激活还没回来时，主体报刚要去的那张：马上离开也不会把记录改写成旧的那张', async () => {
    const { host, places, history, current } = await start(['Default', 'Chill']);
    const held = host.hold('playlist.setActive');
    places.open(guidOf(1));
    history.navigate({ id: 'albums' });
    expect(current().previous).toEqual({ id: 'playlist', subject: guidOf(1) });
    held.release();
  });

  it('点了 B 又点回 A：B 的读回在点 A 之后才到，当前这条也不被改写成 B', async () => {
    const { host, places, current } = await start(['Default', 'Chill']);
    const reads = host.hold('playlist.getAll');
    places.open(guidOf(1));
    await settle();
    const switches = host.hold('playlist.setActive');
    places.open(guidOf(0));
    await settle();
    expect(switches.pending).toEqual([{ playlistGuid: guidOf(0) }]);
    // 宿主按先后作答：B 激活后发出的那次读排在切回 A 之前，读回的活动列表是 B。
    reads.respond(0);
    await settle();
    expect(current().place).toEqual({ id: 'playlist', subject: guidOf(0) });
    switches.release();
    reads.release();
    await settle();
    expect(current().place).toEqual({ id: 'playlist', subject: guidOf(0) });
  });

  it('切换被拒：主体仍报要去的那张，活动列表之后变了才跟着活动列表', async () => {
    const { host, fake, places, history, current } = await start(['Default', 'Chill', 'Road']);
    host.answer('playlist.setActive', hostFailure('NOT_FOUND'));
    places.open(guidOf(1));
    await settle();
    history.subjectsChanged();
    expect(current().place).toEqual({ id: 'playlist', subject: guidOf(1) });
    fake.items = fake.items.map((item) => ({ ...item, isActive: item.index === 2 }));
    host.emit('playlist:activated', { newGuid: guidOf(2), oldIndex: 0, newIndex: 2 });
    await settle();
    expect(current().place).toEqual({ id: 'playlist', subject: guidOf(2) });
  });

  it('[专辑, A, B] 里切到 B 被拒，再后退：历史不丢记录，前进还能回到 B', async () => {
    const { host, places, history, current } = await start(['Default', 'Chill', 'Road']);
    places.open(guidOf(1));
    await settle();
    host.answer('playlist.setActive', hostFailure('NOT_FOUND'));
    places.open(guidOf(2));
    await settle();
    expect(history.back()).toBe(true);
    await settle();
    expect(current().place).toEqual({ id: 'playlist', subject: guidOf(1) });
    expect(current().previous).toEqual({ id: 'albums' });
    expect(current().next).toEqual({ id: 'playlist', subject: guidOf(2) });
  });

  it('[专辑, B, A] 停在 A，后退到 B 被拒，再前进：回到 A，下标不越界', async () => {
    const { host, places, history, current } = await start(['Default', 'Chill', 'Road']);
    places.open(guidOf(1));
    await settle();
    places.open(guidOf(0));
    await settle();
    host.answer('playlist.setActive', hostFailure('NOT_FOUND'));
    expect(history.back()).toBe(true);
    await settle();
    expect(current().place).toEqual({ id: 'playlist', subject: guidOf(1) });
    expect(history.forward()).toBe(true);
    await settle();
    expect(current().place).toEqual({ id: 'playlist', subject: guidOf(0) });
    expect(current().previous).toEqual({ id: 'playlist', subject: guidOf(1) });
  });

  it('地点名按 GUID 从清单里查列表名，查不到写地点名', () => {
    const t = createTranslate(en, {});
    const names = new Map([[guidOf(1), 'Chill']]);
    const lookup = (guid: string) => names.get(guid);
    expect(placeName({ id: 'playlist', subject: guidOf(1) }, t, lookup)).toBe('Chill');
    expect(placeName({ id: 'playlist', subject: guidOf(9) }, t, lookup)).toBe('Playlist');
    expect(placeName({ id: 'playlist', subject: guidOf(1) }, t)).toBe('Playlist');
  });
});
