import type { ComponentProps } from 'react';
import styles from './SurfaceFrame.module.css';

/**
 * 预设与舞台的外框
 *
 * 就是一个 div：把元素共用的那组表面变量（文字三档、描边、悬停、按下、选中、占位底，见样式文件）挂在根上，
 * 版式由使用方的 `className` 与内联样式给。表面归外框、元素只读变量，所以每个预设与 Coverflow 舞台的根都用它，
 * 不各抄一份
 */
export function SurfaceFrame({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div className={className ? `${styles.surface} ${className}` : styles.surface} {...rest} />
  );
}
