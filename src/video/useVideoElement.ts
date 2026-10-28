import { MediaElementFollower } from 'foo-webview-sdk/bridge';
import { useEffect, useRef, useState, type RefObject } from 'react';

export type VideoElementStatus = 'loading' | 'ready' | 'buffering' | 'unsupported' | 'failed';

/** HTMLMediaElement.HAVE_FUTURE_DATA：接下来一小段已可播 */
const HAVE_FUTURE_DATA = 3;

/**
 * 元素是否卡在等数据。只有该往前走时才算：跟随器在 fb2k 暂停、对时跳转前都会先暂停元素，
 * 那时画面不动是预期的，不是缓冲
 */
export function isStalled(video: Pick<HTMLMediaElement, 'paused' | 'readyState'>): boolean {
  return !video.paused && video.readyState < HAVE_FUTURE_DATA;
}

/** 元素的数据与传输状态一变就重新判一次是否卡住 */
const STALL_EVENTS = ['waiting', 'canplay', 'seeked', 'pause'] as const;

/** 缓冲只发生在已出画面之后：加载中、失败与不支持不因元素的等待而改变，等待结束或元素暂停就回到就绪 */
export function followStalled(status: VideoElementStatus, stalled: boolean): VideoElementStatus {
  if (status === 'ready' && stalled) return 'buffering';
  if (status === 'buffering' && !stalled) return 'ready';
  return status;
}

/**
 * 让静音的 video 元素跟随 fb2k 的播放位置。跟随器与元素同生共死，换曲只换源：
 * 同一文件在章节间切换时 SDK 沿用已加载的资源，只改时间轴起点
 */
export function useVideoElement(
  ref: RefObject<HTMLVideoElement | null>,
  path: string | null,
  timelineOffset: number,
  active: boolean,
  retry: number,
): VideoElementStatus {
  const [status, setStatus] = useState<VideoElementStatus>('loading');
  const follower = useRef<MediaElementFollower | null>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || !active) return;
    let disposed = false;
    const instance = new MediaElementFollower(video);
    follower.current = instance;
    const failed = () => {
      if (!disposed)
        setStatus(video.error?.code === 3 || video.error?.code === 4 ? 'unsupported' : 'failed');
    };
    // 容器能读、画面解不了时（如 MPEG-4 Part 2 配 AAC），元素只剩音轨：装载照常完成，宽度为 0，不报错
    const ready = () => {
      if (disposed) return;
      if (video.videoWidth > 0) {
        setStatus('ready');
        return;
      }
      setStatus('unsupported');
      void instance.setSource(null).catch(() => {});
    };
    // 缓冲与否只看元素此刻的状态，不按事件记旗：对时跳转（seeking）与暂停期间的等待都不算
    const stalled = () => {
      if (!disposed) setStatus((value) => followStalled(value, isStalled(video)));
    };
    const off = instance.onError(failed);
    video.addEventListener('loadeddata', ready);
    video.addEventListener('playing', ready);
    for (const name of STALL_EVENTS) video.addEventListener(name, stalled);
    return () => {
      disposed = true;
      follower.current = null;
      off();
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('playing', ready);
      for (const name of STALL_EVENTS) video.removeEventListener(name, stalled);
      instance.dispose();
    };
  }, [ref, active, retry]);
  useEffect(() => {
    const video = ref.current;
    const instance = follower.current;
    if (!video || !instance || !active) return;
    let stale = false;
    if (!path) {
      setStatus('loading');
      void instance.setSource(null).catch(() => {});
      return;
    }
    // 沿用的资源不会再触发装载事件，已有画面数据时不回到加载中
    if (video.readyState < 2) setStatus('loading');
    instance
      .setSource(path, { timelineOffset })
      .then(() => {
        if (!stale && video.readyState >= 2 && video.videoWidth > 0) setStatus('ready');
      })
      .catch(() => {
        if (!stale) setStatus('failed');
      });
    return () => {
      stale = true;
    };
  }, [ref, path, timelineOffset, active, retry]);
  return status;
}
