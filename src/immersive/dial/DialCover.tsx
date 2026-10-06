import { Record48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { CSSProperties } from 'react';
import { immersiveCoverAtom } from '../cover/immersiveCover.ts';
import { useViewServices } from '../page/viewServices.ts';
import styles from './DialCover.module.css';

export interface DialCoverProps {
  /** 封面的位置与边长，所在内容层的坐标。 */
  readonly box: CSSProperties;
  /** `data-decor-guard` 的外扩，单位像素：生成式网格不在封面周围这么远以内放装饰。 */
  readonly guard: number;
}

/**
 * 罗盘里的封面：占位盘片一直垫在下面，图叠在上面；地址可用不等于图存在或能解码。封面状态与背景的封面底色
 * 共用同一份，解码结果由这里的 `<img>` 回报。
 */
export function DialCover({ box, guard }: DialCoverProps) {
  const cover = useAtomValueRawSync(immersiveCoverAtom);
  const services = useViewServices();
  const url = cover.status === 'missing' ? null : cover.url;
  const { token } = cover;
  return (
    <div className={styles.cover} style={box} data-decor-guard={guard} data-dial-cover>
      <Record48Regular />
      {/* 按身份换元素：上一张图晚到的 load / error 带的是旧身份，进不了当前这一张。 */}
      {url && (
        <img
          key={token}
          className={styles.art}
          src={url}
          alt=""
          draggable={false}
          onLoad={() => services.cover?.markLoaded(token)}
          onError={() => services.cover?.markFailed(token)}
        />
      )}
    </div>
  );
}
