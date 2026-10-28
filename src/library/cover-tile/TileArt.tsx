import { useCallback, useState, type ComponentType, type ReactNode } from 'react';
import styles from './TileArt.module.css';

export interface TileArtProps {
  /** 图片 URL；为空时仅渲染占位图标 */
  readonly src: string;
  /** 占位图标组件；置于图片底层，图片淡入完成后卸载 */
  readonly placeholder: ComponentType<{ className?: string }>;
  /** 挂载时检查封面服务是否已记录该地址已加载 */
  readonly seen: () => boolean;
  readonly onLoad: () => void;
  readonly onError: () => void;
  /** 是否延迟加载离屏封面（`<img loading="lazy">`）；缺省立即请求 */
  readonly lazy?: boolean;
  /** 是否选中（激活外圈高亮描边） */
  readonly selected?: boolean;
  /** 是否持有键盘焦点；所在网格处于 `:focus-visible` 时绘制焦点环 */
  readonly focused?: boolean;
  /** 覆盖在封面上的角标与悬停操作按钮 */
  readonly children?: ReactNode;
}

interface LoadedArtProps extends Pick<
  TileArtProps,
  'src' | 'seen' | 'lazy' | 'onLoad' | 'onError'
> {
  readonly Placeholder: TileArtProps['placeholder'];
}

/**
 * 封装封面图片与底层占位图
 * 首次加载完成触发淡入过渡，已在缓存或已标记加载过的直接绘制不淡入；同块更新地址时复用节点
 *
 * 状态记录在 DOM data 属性上以避免重渲染；挂载阶段完成缓存检查，避免缓存图片出现单帧空白
 */
function LoadedArt({ src, seen: wasSeen, lazy, onLoad, onError, Placeholder }: LoadedArtProps) {
  const [seen] = useState(wasSeen);
  const [covered, setCovered] = useState(seen);
  const mount = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image) return;
      const cached = image.complete && image.naturalWidth > 0;
      if (seen || cached) image.dataset['instant'] = '';
      if (cached) {
        image.dataset['loaded'] = '';
        setCovered(true);
      }
    },
    [seen],
  );
  return (
    <>
      {!covered && <Placeholder className={styles.placeholder} />}
      <img
        ref={mount}
        className={styles.image}
        src={src}
        alt=""
        loading={lazy ? 'lazy' : undefined}
        draggable={false}
        onLoad={(event) => {
          event.currentTarget.dataset['loaded'] = '';
          onLoad();
        }}
        onTransitionEnd={(event) => {
          if (event.propertyName === 'opacity') setCovered(true);
        }}
        onError={onError}
      />
    </>
  );
}

/**
 * 正方形封面容器：统一圆角、底色与溢出裁切
 * 缺图或错误时展示占位，角标与悬停按钮通过 `children` 叠加；边长由外部 CSS 变量 `--tile-size` 控制
 * 选中与焦点绘制在外圈，避免在深色封面上对比度不足
 */
export function TileArt(props: TileArtProps) {
  const { src, placeholder: Placeholder, selected, focused, children } = props;
  return (
    <div
      className={styles.art}
      data-selected={selected || undefined}
      data-focused={focused || undefined}
    >
      {src ? (
        <LoadedArt
          src={src}
          seen={props.seen}
          lazy={props.lazy}
          onLoad={props.onLoad}
          onError={props.onError}
          Placeholder={Placeholder}
        />
      ) : (
        <Placeholder className={styles.placeholder} />
      )}
      {children}
    </div>
  );
}
