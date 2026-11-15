import { Button, Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import type { MouseEvent, ReactElement } from 'react';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { roleVar } from '../../theme/roles.ts';

const useStyles = makeStyles({
  // 紧凑圆形控制键：28×28 规格，图标槽位尺寸 18px，状态底色由控制样式提供
  key: {
    minWidth: '28px',
    width: '28px',
    height: '28px',
    padding: '0',
    borderRadius: tokens.borderRadiusCircular,
    color: roleVar('text-secondary'),
    '& .fui-Button__icon': { width: '18px', height: '18px', fontSize: '18px' },
    '& svg': { width: '18px', height: '18px' },
  },
});

interface ChipKeyProps {
  readonly icon: ReactElement;
  /** 悬停提示与可访问名称（仅图标按键） */
  readonly label: string;
  /** 禁用状态下保持键盘可聚焦并保留悬停提示 */
  readonly disabled?: boolean;
  readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function ChipKey({ icon, label, disabled = false, onClick }: ChipKeyProps) {
  const classes = useStyles();
  const controls = useViewControlStyles();
  return (
    <Tooltip content={label} relationship="label">
      <Button
        appearance="subtle"
        size="small"
        shape="circular"
        className={mergeClasses(classes.key, controls.icon)}
        icon={icon}
        disabledFocusable={disabled}
        onClick={onClick}
      />
    </Tooltip>
  );
}
