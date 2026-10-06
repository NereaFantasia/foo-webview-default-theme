import {
  Dialog as FluentDialog,
  makeStyles,
  Menu as FluentMenu,
  mergeClasses,
  OverlayDrawer as FluentOverlayDrawer,
  Popover as FluentPopover,
  TabList as FluentTabList,
  type DialogProps,
  type MenuProps,
  type OverlayDrawerProps,
  type PresenceComponentProps,
} from '@fluentui/react-components';
import { useState, type ComponentProps } from 'react';
import { SurfacePresence } from './SurfacePresence.tsx';
import { CURVE, durationVar } from './timing.ts';

/**
 * 菜单、Popover 这类锚在控件上的浮层，照 Windows 11 的菜单：打开时 83 ms 线性淡入，同时从锚点一侧移动 10 px
 * 到位，250 ms、`(0,0,0,1)`；关闭按直接退场，167 ms 反向移动，同时 83 ms 淡出，期间不接指针，
 * 选了命令的那一下之后不会再点中别的项。
 *
 * 替掉 Fluent 缺省的那一套：它的淡入长 400 ms，要过一百多毫秒才接近不透明。窗口底下是宿主提供的
 * Mica，页面层是透明的，半透明的菜单在这段时间里透出底下的内容与材质，看上去像背景在闪。
 *
 * 位移方向读 Fluent 定位层写在弹出层上的方向变量（`@fluentui/react-positioning` 的
 * `POSITIONING_SLIDE_DIRECTION_VAR_X` / `_Y`，按弹出方向取 -1、0、1），没有时不位移；位移叠加在定位层
 * 自己的 transform 之外，不顶掉它。减弱动效时缩成 1 ms，退场保护与完成回调照常执行。
 */
export function FlyoutMotion(props: PresenceComponentProps) {
  return <SurfacePresence {...props} kind="flyout" />;
}

/** 菜单与 Popover 的 `surfaceMotion`，两者的插槽类型相同。 */
export const FLYOUT_MOTION: MenuProps['surfaceMotion'] = {
  children: (_, props) => <FlyoutMotion {...props} />,
};

/**
 * 对话框照 WinUI ContentDialog：打开时从 1.05 缩到原大，250 ms、`(0,0,0,1)`，配 83 ms 淡入；
 * 关闭反着放大到 1.05，167 ms，配 83 ms 淡出。
 */
const DIALOG_MOTION: DialogProps['surfaceMotion'] = {
  children: (_, props) => <SurfacePresence {...props} kind="dialog" />,
};

export function Menu(props: ComponentProps<typeof FluentMenu>) {
  return <FluentMenu surfaceMotion={FLYOUT_MOTION} {...props} />;
}

export function Popover(props: ComponentProps<typeof FluentPopover>) {
  return <FluentPopover surfaceMotion={FLYOUT_MOTION} {...props} />;
}

export function Dialog(props: ComponentProps<typeof FluentDialog>) {
  return <FluentDialog surfaceMotion={DIALOG_MOTION} {...props} />;
}

const DRAWER_MOTION: Record<'start' | 'end', OverlayDrawerProps['surfaceMotion']> = {
  start: { children: (_, presence) => <SurfacePresence {...presence} kind="start" /> },
  end: { children: (_, presence) => <SurfacePresence {...presence} kind="end" /> },
};

export function OverlayDrawer(props: ComponentProps<typeof FluentOverlayDrawer>) {
  const side = props.position === 'end' ? 'end' : 'start';
  return <FluentOverlayDrawer surfaceMotion={DRAWER_MOTION[side]} {...props} />;
}

/**
 * Tab 选中条照 WinUI SelectorBar：不在两项之间滑动，新选中项的条从中间横向展开、同时淡入，
 * 167 ms、`(0,0,0,1)`；旧的条直接消失。Fluent 的条画在选中项的 `::after` 上，自带的滑动是 `transform`
 * 过渡；这里关掉过渡，换成新选中项上的一段 CSS 动画。动画期间 Fluent 量位置时写的偏移被动画盖住，
 * 播完它已归零。只在用户换到另一项时播；首次显示、状态恢复与重复点击不播。
 */
const useTabListStyles = makeStyles({
  still: {
    '& .fui-Tab::after': { transitionProperty: 'none' },
  },
  moved: {
    '& .fui-Tab[aria-selected="true"]::after': {
      transformOrigin: 'center',
      animationName: {
        from: { transform: 'scaleX(0.25)', opacity: 0 },
        to: { transform: 'none', opacity: 1 },
      },
      animationDuration: durationVar('fast'),
      animationTimingFunction: CURVE.decelerateMid.css,
    },
  },
});

export function TabList({
  className,
  onTabSelect,
  onAnimationEnd,
  ...props
}: ComponentProps<typeof FluentTabList>) {
  const classes = useTabListStyles();
  const [selection, setSelection] = useState({
    value: props.selectedValue ?? props.defaultSelectedValue,
    moved: false,
  });
  const selected = props.selectedValue !== undefined ? props.selectedValue : selection.value;
  if (!Object.is(selected, selection.value)) setSelection({ value: selected, moved: false });
  return (
    <FluentTabList
      {...props}
      className={mergeClasses(classes.still, selection.moved && classes.moved, className)}
      onTabSelect={(event, data) => {
        if (!Object.is(selected, data.value)) setSelection({ value: data.value, moved: true });
        onTabSelect?.(event, data);
      }}
      onAnimationEnd={(event) => {
        if (event.nativeEvent.pseudoElement === '::after') {
          setSelection({ value: selected, moved: false });
        }
        onAnimationEnd?.(event);
      }}
    />
  );
}
