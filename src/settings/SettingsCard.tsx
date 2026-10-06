import { useId, type ReactElement, type ReactNode } from 'react';
import styles from './SettingsCard.module.css';
import { useSettingsLayout } from './useSettingsLayout.ts';

/** 交给控件挂 `aria-labelledby`、`aria-describedby` 的两个 id；没有说明行时后一个为 undefined。 */
export interface SettingsCardIds {
  readonly labelId: string;
  readonly descriptionId: string | undefined;
}

export interface SettingsCardProps {
  readonly icon: ReactElement;
  readonly title: string;
  /** 说明行，只写状态、禁用的原因或出错的原因，不写用法介绍。 */
  readonly description?: string;
  /** 说明行写的是出错的原因：换成错误色，读屏播报一次。 */
  readonly error?: boolean;
  /** 附在说明下面的操作反馈，由调用方提供状态与操作。 */
  readonly feedback?: ReactNode;
  /** 控件要占宽度（下拉框）：卡窄时换到标题下面、占满一行。开关与按钮不设，始终在右边。 */
  readonly field?: boolean;
  /** 控件。卡片不知道放进来的是开关、下拉框还是按钮，无障碍名由控件自己按这两个 id 挂。 */
  readonly children: (ids: SettingsCardIds) => ReactNode;
}

/**
 * 读屏的播报区：常驻、看不见，出错时写进原因。读屏只播报已经在文档里的播报区里的变化，播报区若与文字
 * 同时出现多半不念，所以不能等出错了才挂上。看得见的那行错误对读屏藏起来，免得逐行浏览时念两遍；
 * `aria-describedby` 照样取得到它的文字。
 */
export function ErrorAnnouncer({ text }: { readonly text: string | undefined }) {
  return (
    <div className={styles.announcer} role="status">
      {text}
    </div>
  );
}

/** 一项设置的卡片：左边图标，中间标题与一行说明，右边是控件。只管版式，状态与读写归放进来的控件。 */
export function SettingsCard({
  icon,
  title,
  description,
  error = false,
  feedback,
  field = false,
  children,
}: SettingsCardProps) {
  const { compact } = useSettingsLayout();
  const labelId = useId();
  const describedId = useId();
  const descriptionId = description || feedback ? describedId : undefined;
  const stacked = field && compact;
  return (
    <div className={stacked ? `${styles.root} ${styles.stacked}` : styles.root} data-settings-card>
      <span className={styles.icon} aria-hidden>
        {icon}
      </span>
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
