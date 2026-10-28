import { Button, Spinner } from '@fluentui/react-components';
import {
  ArrowClockwise20Regular,
  FolderSearch20Regular,
  VideoOff48Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import type { MessageKey } from '../i18n/en.ts';
import type { VideoBindings } from './videoContext.ts';
import { useVideoElement, type VideoElementStatus } from './useVideoElement.ts';
import { useDelayedFlag } from './useDelayedFlag.ts';
import { useVideoWakeLock } from './useVideoWakeLock.ts';
import type { VideoFit } from './VideoControls.tsx';
import styles from './VideoStage.module.css';

/** 卡住多久才显示「正在缓冲」，毫秒 */
const BUFFERING_DELAY_MS = 500;

export function VideoStage({
  bindings,
  active,
  fit,
  onStatus,
}: {
  readonly bindings: VideoBindings;
  readonly active: boolean;
  readonly fit: VideoFit;
  readonly onStatus: (status: VideoElementStatus) => void;
}) {
  const state = useAtomValueRawSync(bindings.service.state);
  const playback = useAtomValueRawSync(bindings.playback);
  const t = useAtomValueRawSync(translateAtom);
  const video = useRef<HTMLVideoElement>(null);
  const [retry, setRetry] = useState(0);
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const status = useVideoElement(video, state.path, state.timelineOffset, active, retry);
  useEffect(() => onStatus(status), [status, onStatus]);
  const picture = state.status === 'ready' && (status === 'ready' || status === 'buffering');
  useVideoWakeLock(active && picture && playback.playing && status === 'ready');
  let message: MessageKey | null = null;
  if (state.status === 'idle') message = 'player.idle';
  else if (state.status === 'none') message = 'video.none';
  else if (state.status === 'container') message = 'video.container';
  else if (state.status === 'subsong') message = 'video.subsong';
  else if (state.status === 'failed') message = 'video.sourceFailed';
  else if (state.status === 'loading' || status === 'loading') message = 'video.loading';
  else if (status === 'unsupported') message = 'video.unsupported';
  else if (status === 'failed') message = 'video.failed';
  else if (status === 'buffering') message = 'video.buffering';
  // 拖进度、暂停后继续都要让解码器从前一个关键帧重新解到落点，常常卡几十到几百毫秒，
  // 这样的短暂停顿不算缓冲；卡住满一段时间才提示
  const stalled = useDelayedFlag(message === 'video.buffering', BUFFERING_DELAY_MS);
  if (message === 'video.buffering' && !stalled) message = null;
  // 没有可看的画面时，状态与入口都写在占位画面里，成一组居中；只有缓冲是盖在画面上的短暂提示
  // 空闲与没有视频只留入口按钮，不再另写说明，状态以分组名交给读屏用户
  const prompt = message === 'player.idle' || message === 'video.none';
  const retryable =
    message === 'video.failed' ||
    message === 'video.sourceFailed' ||
    message === 'video.unsupported';
  let action: {
    readonly label: MessageKey;
    readonly icon: ReactElement;
    readonly run: () => void;
  } | null = null;
  if (prompt) {
    action = { label: 'video.browse', icon: <FolderSearch20Regular />, run: bindings.browse };
  } else if (retryable) {
    action = {
      label: 'video.retry',
      icon: <ArrowClockwise20Regular />,
      run: () => {
        if (state.status === 'failed') bindings.service.retry();
        else setRetry((value) => value + 1);
      },
    };
  }
  return (
    <div className={styles.root} data-video-status={message ?? 'ready'}>
      <video
        ref={video}
        muted
        playsInline
        disablePictureInPicture
        className={styles.picture}
        data-fit={fit}
        data-visible={picture || undefined}
        aria-label={t('place.video')}
      />
      {!picture && (
        <div
          className={styles.poster}
          role={prompt ? 'group' : undefined}
          aria-label={prompt && message ? t(message) : undefined}
        >
          {playback.cover && playback.cover !== failedCover ? (
            <img src={playback.cover} alt="" onError={() => setFailedCover(playback.cover)} />
          ) : (
            <VideoOff48Regular className={styles.posterIcon} />
          )}
          {message && !prompt && (
            <div className={styles.status} role="status">
              {message === 'video.loading' && <Spinner size="tiny" />}
              <span>{t(message, state.format ? { format: state.format } : undefined)}</span>
            </div>
          )}
          {action && (
            <Button appearance="primary" size="large" icon={action.icon} onClick={action.run}>
              {t(action.label)}
            </Button>
          )}
        </div>
      )}
      {message === 'video.buffering' && (
        <div className={styles.notice} role="status">
          <Spinner size="tiny" />
          <span>{t(message)}</span>
        </div>
      )}
    </div>
  );
}
