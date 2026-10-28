import { Button, Tag, TagGroup, makeStyles } from '@fluentui/react-components';
import { Add16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import styles from './FacetConditions.module.css';

export interface FacetChip {
  readonly key: string;
  readonly label: string;
}

export interface FacetConditionsProps {
  /** 条件片组的读屏名 */
  readonly label: string;
  readonly chips: readonly FacetChip[];
  /** 移除一枚条件片的读屏名 */
  readonly removeLabel: (chip: FacetChip) => string;
  readonly clearLabel: string;
  /** 外框的内边距由页面给：各页的版心不同 */
  readonly className?: string;
  onRemove(key: string): void;
  /** 没有自定义条件可加的页面不给，「添加条件」就不出 */
  onAdd?(): void;
  onClear(): void;
}

const useStyles = makeStyles({ chips: { flexWrap: 'wrap', minWidth: 0 } });

/** 在结果列表上方展示当前生效的分面条件标签，支持单独移除与全部清空；无条件时不渲染 */
export function FacetConditions({
  label,
  chips,
  removeLabel,
  clearLabel,
  className,
  onRemove,
  onAdd,
  onClear,
}: FacetConditionsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const controls = useViewControlStyles();
  if (chips.length === 0) return null;
  return (
    <div className={className ? `${styles.root} ${className}` : styles.root} data-facet-conditions>
      <div className={styles.chips}>
        <TagGroup
          className={classes.chips}
          size="small"
          aria-label={label}
          onDismiss={(_, data) => onRemove(String(data.value))}
        >
          {chips.map((chip) => (
            <Tag
              key={chip.key}
              value={chip.key}
              appearance="outline"
              className={controls.tag}
              dismissible
              dismissIcon={{ 'aria-label': removeLabel(chip) }}
            >
              {chip.label}
            </Tag>
          ))}
        </TagGroup>
        {onAdd && (
          <Button
            appearance="subtle"
            className={controls.icon}
            size="small"
            icon={<Add16Regular />}
            onClick={onAdd}
          >
            {t('query.addCondition')}
          </Button>
        )}
      </div>
      <Button size="small" appearance="subtle" className={controls.icon} onClick={onClear}>
        {clearLabel}
      </Button>
    </div>
  );
}
