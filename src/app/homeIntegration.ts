import { atom } from 'jotai/vanilla';
import { fb } from 'foo-webview-sdk/bridge';
import type { MessageKey } from '../i18n/en.ts';
import { albumKeyOf, trackPathOf } from '../host/libraryContract.ts';
import { albumsAtom } from '../library/albums.ts';
import { playlistsAtom } from '../playback/playlists.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { exclusive } from '../playback/libraryView.ts';
import { createQueryAutoplaylist, playByQuery } from '../library/libraryQueryFill.ts';
import { CHANNEL_PREVIEW_LIMIT, startChannelQuery } from '../library/home/channelQuery.ts';
import { CHANNEL_SORT_PATTERNS, startHomeChannels } from '../library/home/homeChannels.ts';
import { startHomeFeed } from '../library/home/homeFeed.ts';
import { startHomeRecent } from '../library/home/homeRecent.ts';
import { homePinKey, startHomePins, type HomePin } from '../library/home/homePins.ts';
import { homeGemQuery } from '../library/home/homeModel.ts';
import type { HomeServices } from '../library/home/homeContext.ts';
import type { AppServices } from './services.ts';

export function startHomeIntegration(
  services: Pick<
    AppServices,
    | 'store'
    | 'albums'
    | 'trackActions'
    | 'albumList'
    | 'albumDetail'
    | 'playlistPlaces'
    | 'playbackSource'
    | 'history'
    | 'songs'
    | 'configWriter'
  >,
): HomeServices {
  const { store, albums, trackActions, albumList, playbackSource, history, songs } = services;
  const feed = startHomeFeed(store, albumList.tracks);
  const recent = startHomeRecent(store);
  const pins = startHomePins(store);
  const channels = startHomeChannels(store, undefined, services.configWriter);
  const pinChoices = atom<readonly HomePin[]>((get) => {
    const catalog = get(albumsAtom);
    const lists = get(playlistsAtom);
    const saved = get(channels.state);
    return [
      ...(catalog.status === 'ready'
        ? catalog.albums.map((album): HomePin => ({
            kind: 'album',
            subject: albumKeyOf(album),
            name: album.name,
          }))
        : []),
      ...(lists.status === 'connected' && !lists.readFailed
        ? lists.items.map((list): HomePin => ({
            kind: 'playlist',
            subject: list.guid,
            name: list.name,
          }))
        : []),
      ...(saved.status === 'ready'
        ? saved.items.map((channel): HomePin => ({
            kind: 'channel',
            subject: channel.id,
            name: channel.name,
          }))
        : []),
    ];
  });
  const notice = atom<MessageKey | null>(null);
  const busy = atom(false);
  let disposed = false;

  async function run(action: (current: () => boolean) => Promise<boolean>) {
    if (disposed || store.get(busy)) return false;
    store.set(busy, true);
    store.set(notice, null);
    const entry = store.get(historyAtom).entry;
    const current = () => !disposed && store.get(historyAtom).entry === entry;
    try {
      const ok = await action(current);
      if (!disposed && !ok) store.set(notice, 'home.commandFailed');
      return ok;
    } catch {
      if (!disposed) store.set(notice, 'home.commandFailed');
      return false;
    } finally {
      if (!disposed) store.set(busy, false);
    }
  }

  return {
    feed,
    recent,
    pins,
    pinChoices,
    channels,
    notice,
    busy,
    createQuery: (preview = false) =>
      startChannelQuery(store, preview ? CHANNEL_PREVIEW_LIMIT : undefined),
    playAlbum: (album) => run(() => albums.actions.play(album)),
    playGem: (track, mode) =>
      run(() =>
        trackActions.playPaths([trackPathOf(track)], 0, {
          kind: 'songs',
          subject: homeGemQuery(mode),
          name: '',
        }),
      ),
    shuffle: () =>
      run(async (current) => {
        const ok = await exclusive(store, () =>
          playByQuery(fb, { query: 'ALL', sort: '', descending: false }, 'shuffle', current),
        );
        if (ok === true && !disposed)
          playbackSource.record({ kind: 'songs', subject: 'ALL', name: '' });
        return ok === true;
      }),
    createAutoplaylist: (channel) =>
      run((current) =>
        createQueryAutoplaylist(
          fb,
          channel.name,
          {
            query: channel.query,
            sort: CHANNEL_SORT_PATTERNS[channel.sort],
          },
          current,
        ),
      ),
    openGems(mode) {
      history.navigate({ id: 'songs' });
      songs.filter.clear();
      songs.filter.setQuery({ mode: 'advanced', text: '', advancedText: homeGemQuery(mode) });
      songs.rows.flush();
    },
    openChannel: (channel) => history.navigate({ id: 'channel', subject: channel.id }),
    openPin(pin) {
      if (!store.get(pinChoices).some((item) => homePinKey(item) === homePinKey(pin))) return;
      if (pin.kind === 'playlist') services.playlistPlaces.open(pin.subject);
      else if (pin.kind === 'channel') history.navigate({ id: 'channel', subject: pin.subject });
      else {
        const album = store.get(albumsAtom).albums.find((item) => albumKeyOf(item) === pin.subject);
        if (album) services.albumDetail.open(album);
      }
    },
    dispose() {
      disposed = true;
      feed.dispose();
      recent.dispose();
      channels.dispose();
    },
  };
}
