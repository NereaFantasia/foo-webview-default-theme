import { Rating, RatingItem } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { MAX_RATING, type RatedTrack } from '../../../track/ratingLedger.ts';
import { ratingsVersionAtom, ratingsKey } from '../../../track/trackRatings.ts';
import { useService } from '../../../kit/useService.ts';

const VALUES = Array.from({ length: MAX_RATING }, (_, at) => at + 1);

/** 点中的是不是当前值那一颗：它已经选着，浏览器不再发 change，只有这次 click。 */
function clickedCurrent(event: MouseEvent<HTMLDivElement>, value: number): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement && target.type === 'radio' && Number(target.value) === value
  );
}

export interface QueueRatingProps {
  readonly track: RatedTrack;
  readonly className?: string;
  readonly size?: 'small' | 'medium';
}

/**
 * 队列行标题后面的五颗星，读写都经评分服务，与表格、播放栏里的星同一份真值：点第 N 颗写 N 星，点当前那颗
 * 清零，双击的第二下不算。行在什么时候露出它由行的样式管。不能评分的（网络流）不画。
 */
export function QueueRating({ track, className, size = 'small' }: QueueRatingProps) {
  const t = useAtomValueRawSync(translateAtom);
  const ratings = useService(ratingsKey);
  useAtomValueRawSync(ratingsVersionAtom);
  const [stamped, setStamped] = useState(() => ({ track, stamp: ratings.stamp() }));
  if (stamped.track !== track) setStamped({ track, stamp: ratings.stamp() });
  const { stamp } = stamped;
  useEffect(() => ratings.watch([track], stamp), [ratings, track, stamp]);
  const repeated = useRef(false);
  if (!ratings.canRate(track)) return null;
  const value = ratings.ratingOf(track, stamp);
  const rate = (next: number) => void ratings.setRating(track, next);
  return (
    <Rating
      className={className}
      size={size}
      color="brand"
      value={value}
      aria-label={t('trackMenu.rating')}
      data-queue-rating
      onClick={(event) => {
        event.stopPropagation();
        repeated.current = event.detail >= 2;
        if (!repeated.current && clickedCurrent(event, value)) rate(0);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={() => {
        repeated.current = false;
      }}
      onChange={(_, data) => {
        if (!repeated.current) rate(data.value);
      }}
    >
      {VALUES.map((star) => (
        <RatingItem key={star} value={star} />
      ))}
    </Rating>
  );
}
