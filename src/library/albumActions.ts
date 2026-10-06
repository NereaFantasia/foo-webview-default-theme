import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';
import { translateAtom } from '../i18n/locale.ts';
import type { Store } from '../kit/store.ts';
import { albumMenuAtom, menuPathsOf } from './albumMenu.ts';
import { albumAutoplaylistQuery, fetchAlbumTracks, type AlbumTracksFace } from './albumTracks.ts';
import { albumKeyOf, trackPathOf, type Album } from '../host/libraryContract.ts';
import type { RecordedSource } from '../playback/playbackSource.ts';
import type { TrackActionsService } from '../track/trackActions.ts';
import type { SendTarget } from '../track/trackListActions.ts';

/** 从一张专辑起播（整张或其中几首）时记的来源。 */
export function albumSource(album: Album): RecordedSource {
  return { kind: 'album', subject: albumKeyOf(album), name: album.name };
}

export interface AlbumActionsFace extends AlbumTracksFace {
  playlist: Pick<typeof fb.playlist, 'createAutoplaylist' | 'setActive'>;
}

/**
 * 专辑的动作，经 `TrackActionsService` 执行，失败与忙碌的提示也挂在那里。菜单那几项作用于 `albumMenuAtom`
 * 里准备好的那一批（右键与「更多」同一份），曲目没到手或过了上限时不发、答 false。
 */
export interface AlbumActionsService {
  /** 从这张专辑的第 `index` 首起播：双击封面、回车与悬停的播放键都走这里。 */
  play(album: Album, index?: number): Promise<boolean>;
  /** 发到「发送到」子菜单里点的那一项；那张列表已经删了或锁着时宿主拒收，同样挂命令失败。 */
  sendTo(target: SendTarget): Promise<boolean>;
  sendToNew(): Promise<boolean>;
  /** 建成后切为活动列表。 */
  createAutoplaylist(): Promise<boolean>;
}

export function startAlbumActions(
  store: Store,
  tracks: TrackActionsService,
  host: AlbumActionsFace = fb,
): AlbumActionsService {
  function onMenu(run: (paths: string[]) => Promise<boolean>): Promise<boolean> {
    const paths = menuPathsOf(store.get(albumMenuAtom));
    return paths ? run(paths) : Promise.resolve(false);
  }

  /** 一首曲目叫曲名，一张专辑叫专辑名（没有名字用缺省名），多张叫「首张 等 N 张」。 */
  function batchName(albums: readonly Album[]): string {
    const translate = store.get(translateAtom);
    const menu = store.get(albumMenuAtom);
    const first =
      (menu.trackIndex !== null && menu.tracks.length === 1
        ? menu.tracks[0]?.title
        : albums[0]?.name) ?? '';
    if (albums.length <= 1) return first || translate('album.newPlaylist');
    return translate('album.batchName', { first, count: albums.length, rest: albums.length - 1 });
  }

  return {
    play: (album, index = 0) =>
      tracks.playLoaded(
        async () => {
          const rows = await settle(() => fetchAlbumTracks(host, album));
          return rows ? rows.map(trackPathOf) : null;
        },
        index,
        albumSource(album),
      ),
    sendTo: (target) => onMenu((paths) => tracks.sendPathsTo(paths, target)),
    sendToNew() {
      const name = batchName(store.get(albumMenuAtom).albums);
      return onMenu((paths) => tracks.sendPathsToNew(paths, name));
    },
    createAutoplaylist() {
      const { albums } = store.get(albumMenuAtom);
      const query = albumAutoplaylistQuery(albums);
      if (!query) return Promise.resolve(false);
      const name = batchName(albums);
      return tracks.command(async () => {
        const created = await settle(() => host.playlist.createAutoplaylist(name, query));
        if (!created || created.success === false) return false;
        const active = await settle(() => host.playlist.setActive(created.index));
        return !!active && active.success !== false;
      });
    },
  };
}
