import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { roleVar } from '../../theme/roles.ts';

/** 播控键尺寸档位：compact (36px)、regular (40px)、large (48px) */
export type KeySize = 'compact' | 'regular' | 'large';

/**
 * 沉浸模式播控按键通用样式规则
 *
 * 定义紧凑、常规与大号尺寸的点击热区与居中图标规格，次要按键使用次级文字色，主播放键采用主文字色并继承统一样式反馈
 */
export const useKeyStyles = makeStyles({
  key: {
    minWidth: '40px',
    width: '40px',
    height: '40px',
    padding: '0',
    borderRadius: tokens.borderRadiusXLarge,
    color: roleVar('text-secondary'),
    '& .fui-Button__icon, & svg': { width: '24px', height: '24px', fontSize: '24px' },
  },
  compact: { minWidth: '36px', width: '36px', height: '36px' },
  large: {
    minWidth: '48px',
    width: '48px',
    height: '48px',
    '& .fui-Button__icon, & svg': { width: '28px', height: '28px', fontSize: '28px' },
  },
  primary: { color: roleVar('text-primary') },
});

/** 根据尺寸档位组装按键类名 */
export function keyClass(classes: ReturnType<typeof useKeyStyles>, size: KeySize): string {
  return mergeClasses(
    classes.key,
    size === 'compact' && classes.compact,
    size === 'large' && classes.large,
  );
}
