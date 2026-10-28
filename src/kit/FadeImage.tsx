import { useCallback, type ImgHTMLAttributes } from 'react';
import styles from './FadeImage.module.css';

/** 缓存已加载完成的图片 URL：节点重新挂载时若在缓存中则直接展示，避免虚拟滚动复用节点时重复闪烁；达到容量上限后清空 */
const loadedUrls = new Set<string>();
const LOADED_LIMIT = 400;

type FadeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { readonly src: string };

function Fading({ src, className, onLoad, ...rest }: FadeImageProps) {
  const mount = useCallback(
    (image: HTMLImageElement | null) => {
      const cached = image?.complete && image.naturalWidth > 0;
      if (image && !cached && !loadedUrls.has(src)) image.dataset['loading'] = '';
    },
    [src],
  );
  return (
    <img
      {...rest}
      ref={mount}
      src={src}
      className={className ? `${styles.image} ${className}` : styles.image}
      onLoad={(event) => {
        if (loadedUrls.size >= LOADED_LIMIT) loadedUrls.clear();
        loadedUrls.add(src);
        event.currentTarget.removeAttribute('data-loading');
        onLoad?.(event);
      }}
    />
  );
}

/**
 * 带渐隐过渡的图片组件：未命中缓存时在加载完成后淡入，缓存命中时即时显示
 * 初始状态保持默认可见，仅在未就绪且非缓存时打上 data-loading 遮盖，避免队列切歌退场动画克隆节点（清除 data 属性）时封面意外消失；切换 src 时通过 key 重置生命周期
 */
export function FadeImage(props: FadeImageProps) {
  return <Fading key={props.src} {...props} />;
}
