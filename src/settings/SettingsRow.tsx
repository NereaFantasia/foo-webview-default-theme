import { useId, type ReactNode } from 'react';
import { ErrorAnnouncer, type SettingsCardIds } from './SettingsCard.tsx';
import styles from './SettingsRow.module.css';
import { useSettingsLayout } from './useSettingsLayout.ts';

export interface SettingsRowProps {
  readonly title: string;
  /** 跟在标题后面的附注，如版本、作者；不算进控件的无障碍名 */
  readonly meta?: ReactNode;
  /** 说明行，同设置卡：只写状态、禁用的原因或出错的原因 */
  readonly description?: string;
  /** 说明行写的是出错的原因：换成错误色，读屏播报一次 */
  readonly error?: boolean;
  /** 说明行可能很长（第三方给的原话）：最多两行，全文放进悬浮提示 */
  readonly clamp?: boolean;
  /** 附在说明下面的操作反馈 */
  readonly feedback?: ReactNode;
  /** 控件要占宽度（下拉框、滑块）：卡窄时换到标题下面、占满一行 */
  readonly field?: boolean;
  /** 控件整行放在标题下面，不论卡宽。缩略图用 */
  readonly block?: boolean;
  /** 只把文字换成禁用色；控件禁不禁用由调用方给 */
  readonly disabled?: boolean;
  /** 从属于上一行的选项（上一行选到某一档才出）：再缩进一级，标题用次要文字色 */
  readonly nested?: boolean;
  readonly children: (ids: SettingsCardIds) => ReactNode;
}

/**
 * 可展开卡里的一行设置：没有图标，文字缩进到卡头标题的左缘，与上一行之间一条分隔线。版式与无障碍名的
 * 挂法同设置卡，状态与读写归放进来的控件
 */
export function SettingsRow({
  title,
  meta,
  description,
  error = false,
  clamp = false,
  feedback,
  field = false,
  block = false,
  disabled = false,
  nested = false,
  children,
}: SettingsRowProps) {
  const { compact } = useSettingsLayout();
  const labelId = useId();
  const describedId = useId();
  const descriptionId = description || feedback ? describedId : undefined;
  return (
    <div
      className={[
        styles.root,
        nested && styles.nested,
        (block || (field && compact)) && styles.stacked,
        block && styles.block,
        disabled && styles.disabled,
      ]
        .filter(Boolean)
        .join(' ')}
      data-settings-row
    >
      <div className={styles.text}>
        <div className={styles.heading}>
          <div id={labelId} className={styles.title}>
            {title}
          </div>
          {meta && <span className={styles.meta}>{meta}</span>}
        </div>
        {(description || feedback) && (
          <div id={descriptionId}>
            {description && (
              <div
                className={[styles.description, error && styles.error, clamp && styles.clamp]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden={error || undefined}
                title={clamp ? description : undefined}
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
