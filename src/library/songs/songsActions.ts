import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { HostReadyFace } from '../../host/waitForHost.ts';
import type { MessageKey } from '../../i18n/en.ts';
import type { RecordedSource } from '../../playback/playbackSource.ts';
import type { Store } from '../../kit/store.ts';
import {
  createQueryAutoplaylist,
  playByQuery,
  sendQueryToNew,
  type QueryFill,
  type QueryFillFace,
  type QueryPlayStart,
} from '../libraryQueryFill.ts';
import { exclusive } from '../../playback/libraryView.ts';

const PLAY_FAILED: MessageKey = 'songs.playFailed';
const COMMAND_FAILED: MessageKey = 'songs.commandFailed';
const BUSY: MessageKey = 'album.busy';

const noticeAtom = atom<MessageKey | null>(null);

/** 起播与 ⋯ 菜单命令的失败，或上一串还没跑完、这一次没执行的提示；页面挂成横幅。 */
export const songsActionsNoticeAtom: Atom<MessageKey | null> = atom((get) => get(noticeAtom));

export type SongsActionsFace = Pick<HostReadyFace, 'isAvailable'> & QueryFillFace;

/** 页面此刻的那份：交给宿主的查询、排序与方向，以及记进播放来源的名字。 */
export interface SongsRun {
  readonly fill: QueryFill;
  /** 条件的说明，播放栏写成「歌曲 · 说明」；没有条件时是空串，只写「歌曲」。 */
  readonly label: string;
}

export interface SongsActionsDeps {
  /** 起播成功后记下来源，见 `PlaybackSourceService.record`。 */
  readonly record: (source: RecordedSource) => void;
}

export interface SongsActionsService {
  /** 按页面此刻的查询与排序填专用列表，从点中的那一首或打乱之后的第一首起播。 */
  play(run: SongsRun, start: QueryPlayStart): Promise<boolean>;
  /** 按此刻的条件建自动播放列表，建成后切为活动列表。 */
  createAutoplaylist(run: SongsRun, name: string): Promise<boolean>;
  /** 此刻的结果整份发到一张新建的列表，顺序同表格。 */
  sendToNew(run: SongsRun, name: string): Promise<boolean>;
  dismissNotice(): void;
  dispose(): void;
}

/**
 * 歌曲页的起播与成批命令。几千到几万首不传路径，都由宿主按查询填表（`libraryQueryFill.ts`）。动专用列表的
 * 一串与专辑页共用一把锁，正忙时不跑、挂提示。没连上宿主时一律不发。
 */
export function startSongsActions(
  store: Store,
  deps: SongsActionsDeps,
  host: SongsActionsFace = fb,
): SongsActionsService {
  store.set(noticeAtom, null);
  let disposed = false;
  const usable = () => !disposed && host.isAvailable();

  function finish(ok: boolean, failure: MessageKey): boolean {
    if (disposed) return ok;
    if (!ok) store.set(noticeAtom, failure);
    else if (store.get(noticeAtom) !== BUSY) store.set(noticeAtom, null);
    return ok;
  }

  async function direct(step: () => Promise<boolean>): Promise<boolean> {
    return usable() ? finish(await step(), COMMAND_FAILED) : false;
  }

  return {
    async play(run, start) {
      if (!usable()) return false;
      const outcome = await exclusive(store, () => {
        if (store.get(noticeAtom) === BUSY) store.set(noticeAtom, null);
        return playByQuery(host, run.fill, start, usable);
      });
      if (outcome === 'busy') {
        if (!disposed) store.set(noticeAtom, BUSY);
        return false;
      }
      if (outcome && !disposed) {
        deps.record({ kind: 'songs', subject: run.fill.query, name: run.label });
      }
      return finish(outcome, PLAY_FAILED);
    },
    createAutoplaylist: (run, name) =>
      direct(() => createQueryAutoplaylist(host, name, run.fill, usable)),
    sendToNew: (run, name) => direct(() => sendQueryToNew(host, name, run.fill, usable)),
    dismissNotice() {
      if (!disposed) store.set(noticeAtom, null);
    },
    dispose() {
      disposed = true;
    },
  };
}
