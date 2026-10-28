import { useMemo } from 'react';
import type { MessageKey } from '../../../i18n/en.ts';
import { useService } from '../../../kit/useService.ts';
import { onlineListsKey } from '../../../playback/onlineLists.ts';
import type { OnlineObjectTarget } from './OnlineObjectMenu.tsx';
import { onlineListSource, onlinePlayKey } from './onlinePlay.ts';

export interface OnlineObjectActions {
  /**
   * 播放或入队在线对象曲目列表：`queue` 为 null 表示起播，true 插入队首，false 追加队尾
   * 若未预载曲目则动态获取首页列表；加载失败或操作异常调用 `onFailed` 回调
   */
  run(target: OnlineObjectTarget, queue: boolean | null): Promise<void>;
}

/** 封装在线对象起播与入队逻辑，供对象菜单与悬停播放按钮共用 */
export function useOnlineObjectActions(
  onFailed: (message: MessageKey) => void,
): OnlineObjectActions {
  const player = useService(onlinePlayKey);
  const lists = useService(onlineListsKey);
  return useMemo(
    () => ({
      async run(target, queue) {
        const { list } = target;
        const tracks = target.tracks ?? (await lists.tracks({ kind: list.kind, ref: list.ref }));
        const ok = tracks
          ? queue === null
            ? await player.play(tracks, 0, onlineListSource(list))
            : await player.queue(tracks, queue)
          : false;
        if (!ok) onFailed(queue === null ? 'songs.playFailed' : 'online.queueFailed');
      },
    }),
    [player, lists, onFailed],
  );
}
