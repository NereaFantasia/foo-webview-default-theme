import { MusicNote224Regular, Pause48Filled, Play48Filled } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useState } from 'react';
import { artworkRequestSize } from '../../host/artworkSize.ts';
import { coverPathOf } from '../../covers/coverPath.ts';
import { playingAudibleAtom } from '../../playback/playingTrack.ts';
import { useExactQueueCover, useQueueCover } from '../../playback/queue/useQueueCover.ts';
import { useDisplayTrack } from '../../track/displayTrack.ts';
import type { CoverflowItem } from '../scene/coverflowItems.ts';
import styles from './Coverflow.module.css';
import { slotAt } from './slots.ts';

/** 封面流各槽位的封面请求边长（物理像素） */
export interface CoverRequestSizes {
  /** 选中卡片（位于正中）的请求边长 */
  readonly center: number;
  /** 侧翼卡片的请求边长，按第一个侧翼槽位的缩放比例缩小，以减少解码与传输开销 */
  readonly side: number;
}

/** 按设备像素比换算两档请求边长，并对齐到宿主封面尺寸的阶梯（`artworkRequestSize`） */
export function coverRequestSizes(cover: number, ratio: number): CoverRequestSizes {
  return {
    center: artworkRequestSize(cover, ratio),
    side: artworkRequestSize(cover * slotAt(1).size, ratio),
  };
}

/**
 * 已加载过的封面地址。卡片随滚动重新挂载时，这些地址的图片直接显示，不再播放淡入。
 * 集合达到 `LOADED_LIMIT` 时清空
 */
const loadedUrls = new Set<string>();
const LOADED_LIMIT = 400;

/** 封面图片，首次加载时淡入 */
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

/** 悬停在选中卡片上时显示的播放遮罩。正在播放的卡片按播放状态显示播放或暂停图标 */
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
  /** 远离选中项的卡片：对读屏软件隐藏，也不预先加载大图 */
  readonly distant: boolean;
  /** 向舞台登记卡片节点，舞台的动效逐帧直接改写它的内联样式 */
  readonly attach: (key: string, element: HTMLElement | null) => void;
  /** 为视图过渡申请共享名称，只有正在播放的卡片传入 */
  readonly holder: ((element: HTMLElement | null) => (() => void) | void) | undefined;
  readonly onActivate: (key: string) => void;
  /** 右键卡片时调用，`at` 是指针的视口坐标 */
  readonly onMenu: (key: string, at: { readonly x: number; readonly y: number }) => void;
}

/** Coverflow 的封面卡片。位移、旋转与透明度由舞台的动效逐帧写入内联样式，不经 React 渲染 */
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
  // 侧翼档的图作底层，尚未加载时使用行缩略图
  const small = useQueueCover(path, sizes.side);
  // 选中过的卡片在底层之上叠加大图。大图只使用这一档，尚未加载时不退回行缩略图：更模糊的缩略图会盖住侧翼档的图，
  // 使卡片选中时先变模糊。
  // 不在远处的卡片提前加载大图，以便选中时大图已经就绪
  const raised = peak > sizes.side;
  const large = useExactQueueCover(raised || !distant ? path : '', raised ? peak : sizes.center);
  const [failed, setFailed] = useState<readonly string[]>([]);
  const fail = useCallback(
    (url: string) => setFailed((list) => (list.includes(url) ? list : [...list, url])),
    [],
  );
  // 小图在下、大图在上淡入，不替换同一张图片的地址，切换时不会出现空白
  const images = [small, raised ? large : null].filter(
    (url, at, all): url is string => !!url && !failed.includes(url) && all.indexOf(url) === at,
  );
  const { key } = item;
  // 侧翼卡片不显示文字，悬停时由原生提示显示曲名与艺人
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
