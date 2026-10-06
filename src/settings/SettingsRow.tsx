import { useId, type ReactNode } from 'react';
import { ErrorAnnouncer, type SettingsCardIds } from './SettingsCard.tsx';
import styles from './SettingsRow.module.css';
import { useSettingsLayout } from './useSettingsLayout.ts';

export interface SettingsRowProps {
  readonly title: string;
  /** 说明行，同设置卡：只写状态、禁用的原因或出错的原因。 */
  readonly description?: string;
  /** 说明行写的是出错的原因：换成错误色，读屏播报一次。 */
  readonly error?: boolean;
  /** 附在说明下面的操作反馈。 */
  readonly feedback?: ReactNode;
  /** 控件要占宽度（下拉框、滑块）：卡窄时换到标题下面、占满一行。 */
  readonly field?: boolean;
  /** 只把文字换成禁用色；控件禁不禁用由调用方给。 */
  readonly disabled?: boolean;
  readonly children: (ids: SettingsCardIds) => ReactNode;
}

/**
 * 可展开卡里的一行设置：没有图标，文字缩进到卡头标题的左缘，与上一行之间一条分隔线。版式与无障碍名的
 * 挂法同设置卡，状态与读写归放进来的控件。
 */
export function SettingsRow({
  title,
  description,
  error = false,
  feedback,
  field = false,
  disabled = false,
  children,
}: SettingsRowProps) {
  const { compact } = useSettingsLayout();
  const labelId = useId();
  const describedId = useId();
  const descriptionId = description || feedback ? describedId : undefined;
  return (
    <div
      className={[styles.root, field && compact && styles.stacked, disabled && styles.disabled]
        .filter(Boolean)
        .join(' ')}
      data-settings-row
    >
      <div className={styles.text}>
        <div id={labelId} className={styles.title}>
          {title}
        </div>
        {(description || feedback) && (
          <div id={descriptionId}>
            {description && (
              <div
                className={error ? `${styles.description} ${styles.error}` : styles.description}
                aria-hidden={error || undefined}
              >
                {description}
              </div>
            )}
            {feedback}
          </div>
        )}
      </div>
      <ErrorAnnouncer text={error ? description : undefined} />
      <div className={styles.control}>{children({ labelId, descriptionId })}</div>
    </div>
  );
}
