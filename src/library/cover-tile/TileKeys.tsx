import { Button, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { MoreHorizontal16Regular, Pause16Filled, Play16Filled } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ComponentPropsWithRef, MouseEvent } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { PrimaryPlayButton } from '../../theme/PrimaryPlayButton.tsx';
import styles from './TileKeys.module.css';

// 悬停操作按钮使用实色背景以适应多色封面底图；外层容器透传指针事件，仅按钮本身响应交互
const useStyles = makeStyles({
  key: { position: 'absolute', bottom: tokens.spacingVerticalS, pointerEvents: 'auto' },
  play: { left: tokens.spacingHorizontalS },
  more: { right: tokens.spacingHorizontalS },
});

/** 更多按钮左下角锚点坐标，供弹出菜单定位对齐 */
export interface TileKeysPoint {
  readonly x: number;
  readonly y: number;
}

export interface TileKeysProps extends Omit<ComponentPropsWithRef<'div'>, 'onPlay' | 'children'> {
  /** 是否隐藏操作按钮；失焦或移出时平滑淡出，保留原位置以防动画跳变 */
  readonly hidden: boolean;
  /** 播放交互状态；idle 触发起播，playing/paused 触发暂停与恢复 */
  readonly state: 'idle' | 'playing' | 'paused';
  /** 播放按钮无障碍标签；缺省依据 state 状态映射对应文案 */
  readonly playLabel?: string;
  /** 播放按钮是否禁用（如正在起播处理中） */
  readonly playDisabled?: boolean;
  /** 按钮是否允许通过 Tab 键聚焦；键盘操作支持原生快捷键的场景保持禁用 */
  readonly tabbable?: boolean;
  readonly onPlay: () => void;
  readonly onMore: (point: TileKeysPoint) => void;
}

/**
 * 封面悬停操作浮层：左下角主播放键、右下角更多选项键（与右键菜单对齐）
 * 尺寸与绝对坐标由宿主通过 style 传入，显隐采用 83ms 快速线性过渡
 *
 * 默认作为鼠标快捷交互，不抢占键盘焦点；阻止指针事件向外冒泡以防止误触发拖拽或图块选择
 */
export function TileKeys({
  hidden,
  state,
  playLabel,
  playDisabled,
  tabbable,
  onPlay,
  onMore,
  ...root
}: TileKeysProps) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const keep = (event: MouseEvent) => event.preventDefault();
  const label =
    playLabel ??
    (state === 'idle'
      ? t('album.tilePlay')
      : t(state === 'playing' ? 'album.tilePause' : 'album.tileResume'));
  return (
    <div
      {...root}
      className={styles.root}
      data-hidden={hidden || undefined}
      data-tabbable={tabbable || undefined}
    >
      <PrimaryPlayButton
        className={mergeClasses(classes.key, classes.play)}
        shape="circular"
        icon={state === 'playing' ? <Pause16Filled /> : <Play16Filled />}
        aria-label={label}
        disabled={playDisabled}
        tabIndex={tabbable ? undefined : -1}
        data-tile-play
        onMouseDown={keep}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={onPlay}
      />
      <Button
        className={mergeClasses(classes.key, classes.more)}
        appearance="primary"
        shape="circular"
        icon={<MoreHorizontal16Regular />}
        aria-label={t('album.tileMore')}
        tabIndex={tabbable ? undefined : -1}
        data-tile-more
        onMouseDown={keep}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onMore({ x: box.left, y: box.bottom });
        }}
      />
    </div>
  );
}
