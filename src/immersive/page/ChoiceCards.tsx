import type { ReactNode } from 'react';
import styles from './ChoiceCards.module.css';

export interface ChoiceCard<T extends string> {
  readonly value: T;
  readonly label: string;
  /** 缩略图，铺满 16:10 的方框 */
  readonly preview: ReactNode;
}

/**
 * 带缩略图的单选卡片：视图样式、背景渲染器、整轨波形画法这类要看图选的项
 *
 * 一组按钮，选中的那张按下并描一圈强调色边；点中即选，不另有确认。`label` 是这一组的无障碍名
 */
export function ChoiceCards<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly ChoiceCard<T>[];
  onChange(value: T): void;
}) {
  return (
    <div className={styles.cards} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.card}
          aria-pressed={option.value === value}
          data-choice={option.value}
          onClick={() => onChange(option.value)}
        >
          <span className={styles.thumb}>{option.preview}</span>
          <span className={styles.name}>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
