import { MusicNote224Regular, Pause48Filled, Play48Filled } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useState } from 'react';
import { artworkRequestSize } from '../../host/artworkSize.ts';
import { trackOrigin } from '../../host/trackOrigin.ts';
import { playingAudibleAtom } from '../../playback/playingTrack.ts';
import { useQueueCover } from '../../playback/queue/useQueueCover.ts';
import { useDisplayTrack } from '../../track/displayTrack.ts';
import type { CoverflowItem } from '../scene/coverflowItems.ts';
import styles from './Coverflow.module.css';
import { slotAt } from './slots.ts';

/** 封面流各槽位的封面请求边长（物理像素） */
export interface CoverRequestSizes {
  /** 视心中轴选中卡片尺寸，匹配最大展示规格与清晰度 */
  readonly center: number;
  /** 侧翼卡片尺寸，按槽位缩放比例请求较小尺寸以节省解码与传输开销 */
  readonly side: number;
}

/** 计算视心与侧翼卡片的封面请求规格，按设备像素比换算并对齐阶梯规格 */
export function coverRequestSizes(cover: number, ratio: number): CoverRequestSizes {
  return {
    center: artworkRequestSize(cover, ratio),
    side: artworkRequestSize(cover * slotAt(1).size, ratio),
  };
}

/** 获取封面资源请求标识（优先使用句柄，网络流或无曲目时返回空字符串） */
export function coverPathOf(
  track: { readonly path: string; readonly handle: string } | null,
): string {
  if (!track) return '';
  return trackOrigin(track.path) === 'stream' ? '' : track.handle || track.path;
}

/**
 * 已完成首次加载的封面地址集合
 *
 * 避免卡片随视口滚动重新挂载时重复触发淡入闪烁；已在内存缓存的图片直接展示，达到上限后清空重置
 */
const loadedUrls = new Set<string>();
const LOADED_LIMIT = 400;

/** 封面图片节点；已加载过的图片直接呈现，首次加载执行淡入 */
function CoverImage({
  url,
  onError,
}: {
  readonly url: string;
  readonly onError: (url: string) => void;
}) {
  const [loaded, setLoaded] = useState(() => loadedUrls.has(url));
  return (
    <img
      className={styles.image}
      src={url}
      alt=""
      draggable={false}
      data-ready={loaded || undefined}
      onLoad={() => {
        if (loadedUrls.size >= LOADED_LIMIT) loadedUrls.clear();
        loadedUrls.add(url);
        setLoaded(true);
      }}
      onError={() => onError(url)}
    />
  );
}

/** 视心卡片悬停播放遮罩；当前播放曲目随播放状态切换播放与暂停图标 */
function PlayOverlay({ current }: { readonly current: boolean }) {
  const audible = useAtomValueRawSync(playingAudibleAtom);
  return (
    <span className={styles.play} aria-hidden>
      {current && audible ? <Pause48Filled /> : <Play48Filled />}
    </span>
  );
}

export interface CoverflowCardProps {
  readonly item: CoverflowItem;
  readonly id: string;
  readonly selected: boolean;
  readonly sizes: CoverRequestSizes;
  /** 远端卡片排除读屏无障碍焦点序列 */
  readonly distant: boolean;
  /** 向舞台注册节点以便动效引擎逐帧直接更新内联样式 */
  readonly attach: (key: string, element: HTMLElement | null) => void;
  /** 共享过渡命名申请句柄（仅针对正在播放曲目） */
  readonly holder: ((element: HTMLElement | null) => (() => void) | void) | undefined;
  readonly onActivate: (key: string) => void;
  /** 右键卡片回调；at 为光标视口坐标 */
  readonly onMenu: (key: string, at: { readonly x: number; readonly y: number }) => void;
}

/**
 * Coverflow 封面卡片单元
 *
 * 通过队列封面服务分级加载缩略图与大图，大图就绪前以小图占位平滑过渡，缺失时呈现占位图标；
 * 曲目元数据通过统一显示逻辑解析，空间位移、透视旋转与透明度由动效引擎逐帧直接更新内联样式
 */
export function CoverflowCard({
  item,
  id,
  selected,
  sizes,
  distant,
  attach,
  holder,
  onActivate,
  onMenu,
}: CoverflowCardProps) {
  const { track, title } = useDisplayTrack(item.track);
  const [pressed, setPressed] = useState(false);
  const wanted = selected ? sizes.center : sizes.side;
  const [peak, setPeak] = useState(wanted);
  if (wanted > peak) setPeak(wanted);
  const path = coverPathOf(track);
  const large = useQueueCover(path, peak);
  // 请求大图期间以小图占位过渡；仅需侧翼规格时避免重复请求
  const small = useQueueCover(peak > sizes.side ? path : '', sizes.side);
  const [failed, setFailed] = useState<readonly string[]>([]);
  const fail = useCallback(
    (url: string) => setFailed((list) => (list.includes(url) ? list : [...list, url])),
    [],
  );
  // 小图垫底、大图覆盖其上淡入，避免替换源地址造成白屏闪烁
  const images = [small, large].filter(
    (url, at, all): url is string => !!url && !failed.includes(url) && all.indexOf(url) === at,
  );
  const { key } = item;
  // 侧翼卡片无常驻文字标签，通过悬停原生提示展示曲目与艺人信息
  const hint = track ? [title, track.artist].filter(Boolean).join(' · ') : undefined;
  const playable = item.kind !== 'current' || track !== null;
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return undefined;
      attach(key, element);
      const release = holder?.(element);
      return () => {
        attach(key, null);
        release?.();
      };
    },
    [attach, holder, key],
  );
  return (
    <div
      ref={setRef}
      id={id}
      className={styles.card}
      role="option"
      aria-selected={selected}
      aria-hidden={distant || undefined}
      aria-label={title || undefined}
      title={selected ? undefined : hint}
      data-kind={item.kind}
      data-pressed={(selected && pressed) || undefined}
      onClick={() => onActivate(key)}
      onPointerDown={(event) => {
        if (event.button === 0 || event.button === 2) setPressed(true);
      }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setPressed(false);
        onMenu(key, { x: event.clientX, y: event.clientY });
      }}
    >
      {images.length > 0 ? (
        images.map((url) => <CoverImage key={url} url={url} onError={fail} />)
      ) : (
        <MusicNote224Regular className={styles.placeholder} />
      )}
      <span className={styles.shade} aria-hidden />
      {playable && <PlayOverlay current={item.kind === 'current'} />}
    </div>
  );
}
