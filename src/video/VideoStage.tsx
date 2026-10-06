import { Button, Spinner } from '@fluentui/react-components';
import { ArrowClockwise20Regular, VideoOff48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import type { MessageKey } from '../i18n/en.ts';
import type { VideoBindings } from './videoContext.ts';
import { useVideoElement, type VideoElementStatus } from './useVideoElement.ts';
import { useVideoWakeLock } from './useVideoWakeLock.ts';
import type { VideoFit } from './VideoControls.tsx';
import styles from './VideoStage.module.css';

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
  const status = useVideoElement(video, state.path, active, retry);
  useEffect(() => onStatus(status), [status, onStatus]);
  const picture = state.status === 'ready' && (status === 'ready' || status === 'buffering');
  useVideoWakeLock(active && picture && playback.playing && status === 'ready');
  let message: MessageKey | null = null;
  if (state.status === 'idle') message = 'player.idle';
  else if (state.status === 'none') message = 'video.none';
  else if (state.status === 'subsong') message = 'video.subsong';
  else if (state.status === 'failed') message = 'video.sourceFailed';
  else if (state.status === 'loading' || status === 'loading') message = 'video.loading';
  else if (status === 'unsupported') message = 'video.unsupported';
  else if (status === 'failed') message = 'video.failed';
  else if (status === 'buffering') message = 'video.buffering';
  const busy = message === 'video.loading' || message === 'video.buffering';
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
        <div className={styles.poster}>
          {playback.cover && playback.cover !== failedCover ? (
            <img src={playback.cover} alt="" onError={() => setFailedCover(playback.cover)} />
          ) : (
            <VideoOff48Regular />
          )}
        </div>
      )}
      {message && (
        <div className={styles.notice} role="status">
          {busy && <Spinner size="tiny" />}
          <span>{t(message)}</span>
          {(message === 'video.failed' ||
            message === 'video.sourceFailed' ||
            message === 'video.unsupported') && (
            <Button
              icon={<ArrowClockwise20Regular />}
              onClick={() => {
                if (state.status === 'failed') bindings.service.retry();
                else setRetry((value) => value + 1);
              }}
            >
              {t('video.retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
