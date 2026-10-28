import { Button, Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { roleVar } from '../../theme/roles.ts';
import { useBarSurface } from './acrylic.ts';

const useStyles = makeStyles({
  // 药丸分组：高度 36px，采用全圆角胶囊外观；内部按极窄间隙排布紧凑按键
  group: {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    boxSizing: 'border-box',
    height: '36px',
    paddingInline: tokens.spacingHorizontalXS,
    columnGap: tokens.spacingHorizontalXXS,
    borderRadius: tokens.borderRadiusCircular,
  },
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

/** 列头药丸分组容器；采用 Acrylic 材质承载功能相关的紧凑控制键，组间以空白间距分隔 */
export function ChipGroup({ children }: { readonly children: ReactNode }) {
  const classes = useStyles();
  const surface = useBarSurface();
  return (
    <div role="group" className={mergeClasses(classes.group, surface)}>
      {children}
    </div>
  );
}

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
