import { Option, OptionGroup, type PositioningProps } from '@fluentui/react-components';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';

/** 选项多于这个数就按长列表摆：再长也不挪位置 */
const LONG_LIST_OPTIONS = 8;

/** 数一数子节点里有几个选项，进选项组和片段里数；包了自定义组件的数不到 */
function optionCount(children: ReactNode): number {
  let count = 0;
  Children.forEach(children, (child) => {
    if (!isValidElement<{ readonly children?: ReactNode }>(child)) return;
    if (child.type === Option) count += 1;
    else if (child.type === OptionGroup || child.type === Fragment)
      count += optionCount(child.props.children);
  });
  return count;
}

/**
 * 长列表固定在触发控件下方：不盖住它，也不翻到上面或往上挪；高度压到下方剩余的空间，多出的在列表里滚。
 * 短列表不动这一项，仍按各自的缺省摆
 */
const BELOW: PositioningProps = {
  position: 'below',
  align: 'start',
  pinned: true,
  autoSize: 'height',
};

/** 选项多的下拉列表的定位；选项不多时是 null，调用方按缺省摆 */
export function longListPositioning(children: ReactNode): PositioningProps | null {
  return optionCount(children) > LONG_LIST_OPTIONS ? BELOW : null;
}
