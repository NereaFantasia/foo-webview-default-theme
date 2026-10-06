import { MediaElementFollower } from 'foo-webview-sdk/bridge';
import { useEffect, useState, type RefObject } from 'react';

export type VideoElementStatus = 'loading' | 'ready' | 'buffering' | 'unsupported' | 'failed';

export function useVideoElement(
  ref: RefObject<HTMLVideoElement | null>,
  path: string | null,
  active: boolean,
  retry: number,
): VideoElementStatus {
  const [status, setStatus] = useState<VideoElementStatus>('loading');
  useEffect(() => {
    const video = ref.current;
    if (!video || !path || !active) return;
    let disposed = false;
    setStatus('loading');
    const follower = new MediaElementFollower(video);
    const ready = () => setStatus('ready');
    const waiting = () => setStatus('buffering');
    const failed = () => {
      if (!disposed)
        setStatus(video.error?.code === 3 || video.error?.code === 4 ? 'unsupported' : 'failed');
    };
    const off = follower.onError(failed);
    video.addEventListener('loadeddata', ready);
    video.addEventListener('playing', ready);
    video.addEventListener('waiting', waiting);
    video.addEventListener('seeking', waiting);
    video.addEventListener('seeked', ready);
    void follower.setSource(path).catch(failed);
    return () => {
      disposed = true;
      off();
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('playing', ready);
      video.removeEventListener('waiting', waiting);
      video.removeEventListener('seeking', waiting);
      video.removeEventListener('seeked', ready);
      follower.dispose();
    };
  }, [ref, path, active, retry]);
  return status;
}
