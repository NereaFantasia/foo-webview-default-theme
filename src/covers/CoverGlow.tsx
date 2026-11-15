import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useEffect, useRef, useState, type Ref } from 'react';
import { colorSchemeAtom } from '../theme/colorScheme.ts';
import { CoverVisualContext } from './CoverTheme.tsx';
import styles from './CoverGlow.module.css';

function GlowImage({ url, onReady }: { readonly url: string; onReady(url: string): void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  if (state === 'failed') return null;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      className={styles.image}
      data-ready={state === 'ready' || undefined}
      onLoad={() => {
        setState('ready');
        onReady(url);
      }}
      onError={() => {
        setState('failed');
        // 图取不到也算就位：光晕只剩强调色的底，不能一直等一张不会来的图
        onReady(url);
      }}
    />
  );
}

/** 视频画面的 canvas，像素：16:9 的小图，光晕本来就要糊掉，浏览器放大时的双线性插值再柔一层 */
const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 36;
/**
 * 视频播放时两次取样之间的最短间隔，毫秒，即最多每秒 30 次：视频通常只有 24 或 30 帧，更高也没有新画面可取，
 * 光晕又糊成一片，取多了只是重复画同一帧
 */
const SAMPLE_MS = 33;

/**
 * 按页里的视频画光晕：第一帧到了就画，播放时每出一个新画面取一次（不超过 `SAMPLE_MS` 一次）缩进一块小 canvas，光晕跟着
 * 视频变色；暂停、移出视野后视频停了，光晕停在最后取到的那一帧。样式与静图一样（同一套滤镜，外面同一层模糊），叠在静图上
 * 画出后淡入。只显示不读像素，视频跨域也不要紧
 */
function FrameGlow({
  video,
  readyKey,
  onReady,
}: {
  readonly video: HTMLVideoElement;
  /** 画出第一帧时交给 `onReady` 的键：静图的地址，光晕按它判断就位的是不是当前这张 */
  readonly readyKey: string;
  onReady(key: string): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    let first = true;
    const draw = () => {
      if (video.readyState < 2 || video.videoWidth === 0) return;
      context.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      if (!first) return;
      first = false;
      setDrawn(true);
      onReady(readyKey);
    };
    let sampler: ReturnType<typeof setInterval> | undefined;
    let frame: number | undefined;
    const stop = () => {
      clearInterval(sampler);
      sampler = undefined;
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
      frame = undefined;
    };
    // 有新画面时才取：按视频自己的帧节奏走，不会重复取同一帧；不认 requestVideoFrameCallback 时按固定间隔
    const follow = () => {
      stop();
      if (video.paused || video.ended) return;
      if (typeof video.requestVideoFrameCallback !== 'function') {
        sampler = setInterval(draw, SAMPLE_MS);
        return;
      }
      let last = -Infinity;
      const step = (now: DOMHighResTimeStamp) => {
        // 留 4 毫秒的余量：帧到达的时刻有抖动，免得 30 帧的视频被隔掉一半
        if (now - last >= SAMPLE_MS - 4) {
          last = now;
          draw();
        }
        frame = video.requestVideoFrameCallback(step);
      };
      frame = video.requestVideoFrameCallback(step);
    };
    const loaded = () => {
      draw();
      follow();
    };
    draw();
    follow();
    // 第一帧还没到时等它到了再画
    video.addEventListener('loadeddata', loaded);
    video.addEventListener('play', follow);
    video.addEventListener('pause', follow);
    video.addEventListener('ended', follow);
    return () => {
      stop();
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('play', follow);
      video.removeEventListener('pause', follow);
      video.removeEventListener('ended', follow);
    };
  }, [video, readyKey, onReady]);
  return (
    <canvas
      ref={canvas}
      width={FRAME_WIDTH}
      height={FRAME_HEIGHT}
      className={`${styles.image} ${styles.frame}`}
      data-ready={drawn || undefined}
      data-cover-glow-frame
    />
  );
}

/**
 * 本次运行里第一次画光晕时，挂上之后等这么久才画，毫秒。光晕是一大块模糊与混合的绘制，页面刚进来时先让头部与内容出来，
 * 不抢这段的帧；头部的图与取色在这一秒里多半也定了，光晕一出现就是终态，不先后换色
 */
const GLOW_DELAY_MS = 1000;

/** 本次运行里已经画出过光晕：页面与资源都热了，之后挂上的光晕不再等 */
let shownBefore = false;

/**
 * 页面背景的光晕。外框立刻在位（外壳与滚动定位认它），里面的模糊与颗粒第一次要等 `GLOW_DELAY_MS`，之后挂上就画，都淡入；
 * 每处复用换图不再等。`synced` 是页头的整幅头图能画了（或视频在放）时：不按时间等，光晕跟着头图一起出——一挂上就在，
 * 但要等自己的图（或视频的画面）就位才淡入，与头图同时显现；进入等待时当场隐去，换图的位置变化不露出来
 */
export function CoverGlow({
  className = '',
  ref,
  synced = false,
}: {
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
  readonly synced?: boolean;
}) {
  const { url, video } = useContext(CoverVisualContext);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const [late, setLate] = useState(shownBefore);
  // 就位的是哪张图：头图模式下换了图（封面换成头图）要重新等它，不能沿用上一张的就位
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const ready = readyUrl === url;
  const mounted = synced || late;
  const showing = mounted && (!synced || ready);
  useEffect(() => {
    if (showing) {
      shownBefore = true;
      return;
    }
    if (mounted) return;
    const timer = setTimeout(() => setLate(true), GLOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [showing, mounted]);
  return (
    <div
      ref={ref}
      className={`${styles.root} ${className}`}
      data-scheme={scheme}
      data-synced={synced || undefined}
      data-hold={(synced && !ready) || undefined}
      data-cover-glow
      aria-hidden="true"
    >
      {mounted && (
        <>
          <div className={styles.bloom}>
            {url && <GlowImage key={url} url={url} onReady={setReadyUrl} />}
            {video && <FrameGlow video={video} readyKey={url} onReady={setReadyUrl} />}
          </div>
          <div className={styles.grain} />
        </>
      )}
    </div>
  );
}
