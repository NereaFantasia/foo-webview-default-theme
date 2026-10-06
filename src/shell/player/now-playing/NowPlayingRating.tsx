import { Rating, RatingItem, makeStyles } from '@fluentui/react-components';
import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { MAX_RATING } from '../../../track/ratingLedger.ts';
import { ratingsVersionAtom, ratingsKey } from '../../../track/trackRatings.ts';
import styles from './NowPlayingRating.module.css';
import { useService } from '../../../kit/useService.ts';

const VALUES = Array.from({ length: MAX_RATING }, (_, at) => at + 1);

// Fluent 的 small 档是 12；正在播放条与胶囊里星更小，10。
const useStyles = makeStyles({
  compact: { fontSize: '10px', width: '10px', height: '10px' },
});

export interface NowPlayingRatingProps {
  /** `small` 星 12（底部通栏），`compact` 星 10（正在播放条、胶囊）。 */
  readonly size: 'small' | 'compact';
  /** 这一行此刻写的是哪一首：换曲的退场期间还是上一首，星跟着字走。 */
  readonly track: Track | null;
}

/** 点中的是不是当前值那一颗：它已经选着，浏览器不再发 change，只有这次 click。 */
function clickedCurrent(event: MouseEvent<HTMLDivElement>, value: number): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement && target.type === 'radio' && Number(target.value) === value
  );
}

/**
 * 正在播放这一首的星级。读写都经评分服务（`trackRatings.ts`），与表格里的星同一份真值：悬停预览，点第 N 颗写
 * N 星，点当前那颗清零，双击的第二下不算。不能评分的（网络流）不画。外面标了 `data-rating-host` 时，没评分的
 * 只在指针停在那一块上、或焦点在里面时才出空星（正在播放条、胶囊）；不标就一直在（底部通栏）。评过分的一直在。
 */
export function NowPlayingRating({ size, track }: NowPlayingRatingProps) {
  const t = useAtomValueRawSync(translateAtom);
  const ratings = useService(ratingsKey);
  useAtomValueRawSync(ratingsVersionAtom);
  const classes = useStyles();
  // 曲目行随换曲、编辑换成新的一份，同时拿一个新戳：这之后才记下的评分盖过行里带的值。
  const [stamped, setStamped] = useState(() => ({ track, stamp: ratings.stamp() }));
  if (stamped.track !== track) setStamped({ track, stamp: ratings.stamp() });
  const { stamp } = stamped;
  // 一个文件里有好几首时，评分事件分不出是哪一首，登记着这一首逐首补读。
  useEffect(() => (track ? ratings.watch([track], stamp) : undefined), [ratings, track, stamp]);
  const repeated = useRef(false);
  if (!track || !ratings.canRate(track)) return null;
  const value = ratings.ratingOf(track, stamp);
  const rate = (next: number) => void ratings.setRating(track, next);
  return (
    <span className={styles.root} data-now-playing-rating data-unrated={value === 0 || undefined}>
      <Rating
        size="small"
        color="brand"
        value={value}
        aria-label={t('player.rating')}
        // 同一次点击先到 onClick、再到单选框的 onChange，在 onClick 里记下是不是双击的第二下。键盘换星不算：
        // 按键时先清掉，浏览器为方向键补发的点击 detail 也是 0。
        onClick={(event) => {
          repeated.current = event.detail >= 2;
          if (!repeated.current && clickedCurrent(event, value)) rate(0);
        }}
        onKeyDown={() => {
          repeated.current = false;
        }}
        onChange={(_, data) => {
          if (!repeated.current) rate(data.value);
        }}
      >
        {VALUES.map((star) => (
          <RatingItem
            key={star}
            value={star}
            className={size === 'compact' ? classes.compact : undefined}
          />
        ))}
      </Rating>
    </span>
  );
}
