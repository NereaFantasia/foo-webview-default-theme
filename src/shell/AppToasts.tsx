import {
  Link,
  Toast,
  Toaster,
  ToastTitle,
  ToastTrigger,
  useId,
  useToastController,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { playbackFailureAtom } from '../playback/playerAtoms.ts';
import {
  nowPlayingMenuFailureAtom,
  nowPlayingMenuKey,
} from '../playback/now-playing/nowPlayingMenu.ts';
import { ratingsNoticeAtom, ratingsKey } from '../track/trackRatings.ts';
import { useService } from '../kit/useService.ts';
import { playbackKey } from '../playback/playbackContract.ts';
import { failureReason, onlineFailuresKey, onlineSkipAtom } from '../playback/onlineFailures.ts';
import { onlineKey, onlineTracksAtom } from '../playback/onlineTracks.ts';

/** 提示上的那一个动作；没给就是「关闭」 */
interface NoticeAction {
  readonly label: string;
  run(): void;
}

/**
 * 一种提示跟着一个状态走：`message` 有了就出，清掉（下一次写入、重试、关掉）就收；自己到时收起或被点掉时
 * 调 `onDismissed` 把状态也清掉，两边不会一个收着一个还挂着。同一句话再来一次也要重新出一条，按次数编号
 */
function useNoticeToast(
  toasterId: string,
  kind: string,
  message: string | null,
  onDismissed: () => void,
  action?: NoticeAction,
): void {
  const t = useAtomValueRawSync(translateAtom);
  const { dispatchToast, dismissToast } = useToastController(toasterId);
  const count = useRef(0);
  const shown = useRef<string | null>(null);
  const latest = useRef({ onDismissed, action });
  useLayoutEffect(() => {
    latest.current = { onDismissed, action };
  });
  const actionLabel = action?.label ?? null;

  useEffect(() => {
    if (shown.current) dismissToast(shown.current);
    shown.current = null;
    if (!message) return;
    count.current += 1;
    const toastId = `${kind}-notice-${count.current}`;
    shown.current = toastId;
    dispatchToast(
      <Toast data-app-toast={kind}>
        <ToastTitle
          action={
            actionLabel ? (
              <Link onClick={() => latest.current.action?.run()}>{actionLabel}</Link>
            ) : (
              <ToastTrigger>
                <Link>{t('toast.dismiss')}</Link>
              </ToastTrigger>
            )
          }
        >
          {message}
        </ToastTitle>
      </Toast>,
      {
        toastId,
        intent: 'error',
        onStatusChange: (_, data) => {
          if (data.status !== 'dismissed' || shown.current !== toastId) return;
          shown.current = null;
          latest.current.onDismissed();
        },
      },
    );
  }, [kind, message, actionLabel, t, dispatchToast, dismissToast]);
}

/**
 * 全应用共用的轻提示，挂在窗口右下角：写评分失败（评分可以在任何一张表里写，不属于哪一页），与播放的读取、
 * 命令失败（播放栏有三种形态，提示不跟着哪一种走）。读取失败带「重试」，只重新读、不重放命令
 * 在线曲目打不开、fb2k 已跳到下一首时说明曲名与原因，不给重试
 */
export function AppToasts() {
  const t = useAtomValueRawSync(translateAtom);
  const notice = useAtomValueRawSync(ratingsNoticeAtom);
  const failure = useAtomValueRawSync(playbackFailureAtom);
  const menuFailure = useAtomValueRawSync(nowPlayingMenuFailureAtom);
  const ratings = useService(ratingsKey);
  const playback = useService(playbackKey);
  const nowPlayingMenu = useService(nowPlayingMenuKey);
  const skip = useAtomValueRawSync(onlineSkipAtom);
  const onlineTracks = useAtomValueRawSync(onlineTracksAtom);
  const onlineFailures = useService(onlineFailuresKey);
  const toasterId = useId('app-toasts');

  useNoticeToast(toasterId, 'rating', notice ? t(notice) : null, () => ratings.dismissNotice());
  useNoticeToast(toasterId, 'player-menu', menuFailure ? t('album.commandFailed') : null, () =>
    nowPlayingMenu.dismissFailure(),
  );
  useNoticeToast(
    toasterId,
    'playback',
    failure === 'read'
      ? t('toast.playbackReadFailed')
      : failure === 'command'
        ? t('toast.playbackCommandFailed')
        : null,
    () => playback.dismissFailure(),
    failure === 'read' ? { label: t('toast.retry'), run: () => playback.retry() } : undefined,
  );

  useNoticeToast(
    toasterId,
    'online-skip',
    skip
      ? (() => {
          const reason = failureReason(t, skip);
          const title = onlineTracks.get(onlineKey(skip.ref))?.title;
          // 平台给的 ID 不是曲名；查不到展示信息时改用不带标题的文案，不把 ID 当曲名给用户看
          return title
            ? t('online.skipped', { title, reason })
            : t('online.skippedUnknown', { reason });
        })()
      : null,
    () => onlineFailures.dismissSkip(),
  );

  return <Toaster toasterId={toasterId} position="bottom-end" />;
}
