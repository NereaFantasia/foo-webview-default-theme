import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './ArtistHeroImage.module.css';

/** 滚过页头高度的这个比例就当它淡出了，暂停视频 */
const FADED_SHARE = 0.85;

/**
 * 艺人页头部整幅铺满的宽幅图，交给外框的背景层画（`DetailFrame` 的 `backdrop`）：背景层在滚动区外面，
 * 图一直铺到窗口边，滚动条叠在它上面而不是被它让位。图满宽 cover，底部渐隐进页面，高度由背景层定
 *
 * 先后次序：页面给了底色就先铺底色，静帧到了盖在上面淡入；静帧载完、层进过视野之后才开始取视频，视频能放了
 * 才在静帧上淡入并循环静音播放；视频出错就留在静帧。层移出视野或窗口被遮住时暂停
 */
export function ArtistHeroImage({
  url,
  color,
  video,
  onVideo,
}: {
  /** 静帧；还在取时没有 */
  readonly url?: string;
  /** 静帧载入前的底色，六位十六进制 */
  readonly color?: string;
  /** 能放进 `<video src>` 的 mp4 地址；没有动态艺术照或没打开时没有 */
  readonly video?: string;
  /** 视频能放了交出这个元素，卸载时交出 null：页面的光晕取它的第一帧 */
  readonly onVideo?: (element: HTMLVideoElement | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const clip = useRef<HTMLVideoElement>(null);
  const [stillLoaded, setStillLoaded] = useState<string | null>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const seen = entry?.isIntersecting === true;
        setVisible(seen);
        if (seen) setNear(true);
      },
      { threshold: 0.01 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // 往下滚时整层随滚动淡出（见 `DetailFrame`），滚过大半个页头就几乎看不见了：视频不必再放
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    const layer = root.current?.closest<HTMLElement>('[data-detail-backdrop]');
    const scroller = layer?.parentElement?.querySelector<HTMLElement>('[data-detail-scroller]');
    if (!layer || !scroller) return;
    const update = () => {
      const intro = Number.parseFloat(layer.style.getPropertyValue('--detail-intro-height'));
      setFaded(Number.isFinite(intro) && intro > 0 && scroller.scrollTop >= intro * FADED_SHARE);
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, []);
  const [hidden, setHidden] = useState(document.visibilityState === 'hidden');
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const playing = visible && !hidden && !faded;
  useEffect(() => {
    const element = clip.current;
    if (!element) return;
    if (playing) void element.play().catch(() => {});
    else element.pause();
  }, [playing, video, ready]);
  useEffect(() => {
    const element = clip.current;
    if (!onVideo || !element || ready !== video) return;
    onVideo(element);
    return () => onVideo(null);
  }, [onVideo, ready, video]);
  const style = color ? ({ '--artist-hero-color': `#${color}` } as CSSProperties) : undefined;
  const loadVideo = !!video && stillLoaded === url && near && failed !== video;
  return (
    <div className={styles.root} ref={root} style={style}>
      <div className={styles.stage}>
        {url && (
          <img
            className={styles.image}
            src={url}
            alt=""
            draggable={false}
            data-artist-hero
            onLoad={() => setStillLoaded(url)}
          />
        )}
        {loadVideo && (
          <video
            ref={clip}
            className={styles.video}
            src={video}
            data-ready={ready === video || undefined}
            data-artist-hero-video
            muted
            loop
            playsInline
            autoPlay
            preload="auto"
            disablePictureInPicture
            disableRemotePlayback
            aria-hidden
            tabIndex={-1}
            onCanPlay={() => setReady(video)}
            onError={() => setFailed(video)}
          />
        )}
      </div>
    </div>
  );
}
