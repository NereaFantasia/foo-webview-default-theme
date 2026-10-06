import { Rating, RatingItem } from '@fluentui/react-components';
import { memo, useRef, type MouseEvent } from 'react';
import { MAX_RATING } from '../track/ratingLedger.ts';

const VALUES = Array.from({ length: MAX_RATING }, (_, at) => at + 1);

export interface RatingCellProps {
  readonly value: number;
  /** 读屏念的名字，如「等级」。 */
  readonly label: string;
  onRate(value: number): void;
}

/** 点中的是不是当前值那一颗：它已经选着，浏览器不再发 change，只有这次 click。 */
function clickedCurrent(event: MouseEvent<HTMLDivElement>, value: number): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement && target.type === 'radio' && Number(target.value) === value
  );
}

/**
 * 行里的五颗星，取品牌色。悬停预览与单选语义都是 Fluent `Rating` 自带的；点当前值即清零是这里补的。
 *
 * 星不拿焦点：按下时拦住缺省，焦点留在表格上，上下键仍是移焦点而不是改星数；每颗星的单选框也移出 Tab
 * 次序，一屏几十行不会多出几十个 Tab 停靠点。点星的单击照常冒泡到行上，所以点星既选中这一行、又写评分；
 * 双击在这里拦下，连点两颗星不会把曲目播起来。
 *
 * 双击的第二下什么也不写：第一下已经写成了那一颗，第二下点的就是「当前值」，照单击算会把刚写的清零；
 * 第一下正好点在当前值上清了零时，第二下又会把它写回去，中间白删了一次 RATING 标签。
 */
export const RatingCell = memo(function RatingCell({ value, label, onRate }: RatingCellProps) {
  const repeated = useRef(false);
  return (
    <Rating
      size="small"
      color="brand"
      value={value}
      aria-label={label}
      onChange={(_, data) => {
        if (!repeated.current) onRate(data.value);
      }}
      onClick={(event) => {
        if (!repeated.current && clickedCurrent(event, value)) onRate(0);
      }}
      onMouseDown={(event) => {
        repeated.current = event.detail >= 2;
        event.preventDefault();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {VALUES.map((star) => (
        <RatingItem key={star} value={star} fullValueInput={{ tabIndex: -1 }} />
      ))}
    </Rating>
  );
});
